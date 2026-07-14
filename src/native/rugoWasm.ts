import * as path from "path";

// The Emscripten-generated glue module. No @types for it; the surface we
// actually use is small enough to hand-type below rather than pull in a
// speculative full Emscripten Module typing.
interface RugoWasmModule {
  HEAPU8: Uint8Array;
  _wasm_alloc(size: number): number;
  _wasm_free(ptr: number): void;
  ccall(
    name: string,
    returnType: string,
    argTypes: string[],
    args: unknown[]
  ): number;
  UTF8ToString(ptr: number): string;
}

export interface ColumnStats {
  name: string;
  physical_type: string;
  logical_type: string;
  num_values: number;
  total_uncompressed_size: number;
  total_compressed_size: number;
  dictionary_page_offset: number;
  has_min: boolean;
  has_max: boolean;
  min_hex: string;
  max_hex: string;
  null_count: number;
  distinct_count: number;
  has_bloom_filter: boolean;
  column_index_offset: number;
  offset_index_offset: number;
  codec: string;
  encodings: string[];
  repetition_type: number;
  type_length: number;
}

export interface RowGroupStats {
  num_rows: number;
  total_byte_size: number;
  columns: ColumnStats[];
}

export interface SchemaElement {
  name: string;
  full_name: string;
  physical_type: string;
  logical_type: string;
  type_length: number;
  scale: number;
  precision: number;
  repetition_type: number;
  children: SchemaElement[];
}

export interface ParquetMetadata {
  num_rows: number;
  schema: SchemaElement[];
  row_groups: RowGroupStats[];
}

export type ParquetMetadataResult =
  | { ok: true; metadata: ParquetMetadata }
  | { ok: false; error: string };

let modulePromise: Promise<RugoWasmModule> | undefined;

function loadModule(): Promise<RugoWasmModule> {
  if (!modulePromise) {
    // Computed at runtime (not a static string literal) so esbuild does not
    // try to bundle the Emscripten glue file — it's loaded as-is from dist/native.
    const rugoJsPath = path.join(__dirname, "native", "rugo.js");
    const factory = require(rugoJsPath) as () => Promise<RugoWasmModule>;
    modulePromise = factory();
  }
  return modulePromise;
}

export async function readParquetMetadata(
  bytes: Uint8Array
): Promise<ParquetMetadataResult> {
  const mod = await loadModule();

  const ptr = mod._wasm_alloc(bytes.length);
  if (!ptr) {
    throw new Error("wasm_alloc failed (out of WASM memory)");
  }
  mod.HEAPU8.set(bytes, ptr);

  let resultPtr = 0;
  try {
    resultPtr = mod.ccall(
      "read_parquet_metadata_json",
      "number",
      ["number", "number"],
      [ptr, bytes.length]
    );
    const json = mod.UTF8ToString(resultPtr);
    const parsed = JSON.parse(json) as ParquetMetadata | { error: string };
    if ("error" in parsed) {
      return { ok: false, error: parsed.error };
    }
    return { ok: true, metadata: parsed };
  } finally {
    mod._wasm_free(ptr);
    if (resultPtr) {
      mod._wasm_free(resultPtr);
    }
  }
}
