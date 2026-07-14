// C-ABI entry point for the WASM build. Marshalling only — all real parsing
// logic lives in the vendored opteryx-core sources (native/vendor/rugo/src/parquet).
//
// Phase 1 scope: metadata-only (schema, row groups, column-chunk stats,
// bloom-filter presence). No data decode — see scripts/sync-vendor.sh for
// why decode_column.cpp is deliberately out of scope for now.
//
// Buffer-in, JSON-out: the extension host reads the file via VS Code's fs
// API and copies the bytes into WASM memory (wasm_alloc/wasm_free below);
// there is no filesystem access inside the WASM sandbox.
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>

#include "metadata.hpp"

namespace {

void JsonEscape(std::ostringstream &out, const std::string &s) {
  out << '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out << buf;
        } else {
          out << static_cast<char>(c);
        }
    }
  }
  out << '"';
}

// min/max are raw typed bytes (not necessarily valid UTF-8 — e.g. a raw
// int64 or FIXED_LEN_BYTE_ARRAY). Hex-encode rather than risk emitting
// invalid JSON string content; the UI decodes by physical_type.
void JsonHex(std::ostringstream &out, const std::string &s) {
  static const char *hex = "0123456789abcdef";
  out << '"';
  for (unsigned char c : s) {
    out << hex[(c >> 4) & 0xF] << hex[c & 0xF];
  }
  out << '"';
}

void WriteSchemaElement(std::ostringstream &out, const SchemaElement &e) {
  out << '{';
  out << "\"name\":"; JsonEscape(out, e.name); out << ',';
  out << "\"full_name\":"; JsonEscape(out, e.full_name); out << ',';
  out << "\"physical_type\":"; JsonEscape(out, e.physical_type); out << ',';
  out << "\"logical_type\":"; JsonEscape(out, e.logical_type); out << ',';
  out << "\"type_length\":" << e.type_length << ',';
  out << "\"scale\":" << e.scale << ',';
  out << "\"precision\":" << e.precision << ',';
  out << "\"repetition_type\":" << e.repetition_type << ',';
  out << "\"children\":[";
  for (size_t i = 0; i < e.children.size(); ++i) {
    if (i) out << ',';
    WriteSchemaElement(out, e.children[i]);
  }
  out << "]}";
}

void WriteColumnStats(std::ostringstream &out, const ColumnStats &c) {
  out << '{';
  out << "\"name\":"; JsonEscape(out, c.name); out << ',';
  out << "\"physical_type\":"; JsonEscape(out, c.physical_type); out << ',';
  out << "\"logical_type\":"; JsonEscape(out, c.logical_type); out << ',';
  out << "\"num_values\":" << c.num_values << ',';
  out << "\"total_uncompressed_size\":" << c.total_uncompressed_size << ',';
  out << "\"total_compressed_size\":" << c.total_compressed_size << ',';
  out << "\"dictionary_page_offset\":" << c.dictionary_page_offset << ',';
  out << "\"has_min\":" << (c.has_min ? "true" : "false") << ',';
  out << "\"has_max\":" << (c.has_max ? "true" : "false") << ',';
  out << "\"min_hex\":"; JsonHex(out, c.min); out << ',';
  out << "\"max_hex\":"; JsonHex(out, c.max); out << ',';
  out << "\"null_count\":" << c.null_count << ',';
  out << "\"distinct_count\":" << c.distinct_count << ',';
  out << "\"has_bloom_filter\":" << (c.bloom_offset >= 0 ? "true" : "false") << ',';
  out << "\"column_index_offset\":" << c.column_index_offset << ',';
  out << "\"offset_index_offset\":" << c.offset_index_offset << ',';
  out << "\"codec\":"; JsonEscape(out, CompressionCodecToString(c.codec)); out << ',';
  out << "\"encodings\":[";
  for (size_t i = 0; i < c.encodings.size(); ++i) {
    if (i) out << ',';
    JsonEscape(out, EncodingToString(c.encodings[i]));
  }
  out << "],";
  out << "\"repetition_type\":" << c.repetition_type << ',';
  out << "\"type_length\":" << c.type_length;
  out << '}';
}

std::string FileStatsToJson(const FileStats &fs) {
  std::ostringstream out;
  out << '{';
  out << "\"num_rows\":" << fs.num_rows << ',';

  out << "\"schema\":[";
  for (size_t i = 0; i < fs.schema.size(); ++i) {
    if (i) out << ',';
    WriteSchemaElement(out, fs.schema[i]);
  }
  out << "],";

  out << "\"row_groups\":[";
  for (size_t i = 0; i < fs.row_groups.size(); ++i) {
    if (i) out << ',';
    const RowGroupStats &rg = fs.row_groups[i];
    out << '{';
    out << "\"num_rows\":" << rg.num_rows << ',';
    out << "\"total_byte_size\":" << rg.total_byte_size << ',';
    out << "\"columns\":[";
    for (size_t j = 0; j < rg.columns.size(); ++j) {
      if (j) out << ',';
      WriteColumnStats(out, rg.columns[j]);
    }
    out << "]}";
  }
  out << "]}";

  return out.str();
}

std::string ErrorJson(const std::string &message) {
  std::ostringstream out;
  out << "{\"error\":";
  JsonEscape(out, message);
  out << '}';
  return out.str();
}

}  // namespace

extern "C" {

// Allocate/free a buffer in WASM linear memory so JS can copy file bytes in
// and read result strings out without a second copy on our side.
uint8_t *wasm_alloc(size_t size) {
  return static_cast<uint8_t *>(std::malloc(size));
}

void wasm_free(void *ptr) {
  std::free(ptr);
}

// Returns a NUL-terminated JSON string (heap-allocated; caller must
// wasm_free it). On parse failure, returns {"error": "..."} rather than
// throwing across the WASM boundary or returning null.
char *read_parquet_metadata_json(const uint8_t *buf, size_t size) {
  std::string json;
  try {
    FileStats fs = ReadParquetMetadataFromBuffer(buf, size);
    json = FileStatsToJson(fs);
  } catch (const std::exception &e) {
    json = ErrorJson(e.what());
  } catch (...) {
    json = ErrorJson("unknown error reading parquet metadata");
  }

  char *out = static_cast<char *>(std::malloc(json.size() + 1));
  std::memcpy(out, json.c_str(), json.size() + 1);
  return out;
}

}  // extern "C"
