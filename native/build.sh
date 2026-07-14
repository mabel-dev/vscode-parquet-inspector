#!/usr/bin/env bash
# Compiles native/src/rugo_wasm_entry.cpp + the vendored metadata/bloom_filter
# sources to WASM. Requires emcc (brew install emscripten) and a prior run of
# scripts/sync-vendor.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/native/vendor/rugo/src/parquet"
OUT_DIR="$ROOT/dist/native"

if [[ ! -f "$VENDOR/metadata.cpp" ]]; then
  echo "error: $VENDOR/metadata.cpp missing — run scripts/sync-vendor.sh first" >&2
  exit 1
fi

EMCC="$(command -v emcc || echo /opt/homebrew/opt/emscripten/bin/emcc)"
if [[ ! -x "$EMCC" ]]; then
  echo "error: emcc not found (brew install emscripten)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

"$EMCC" \
  -std=c++17 -O2 -fexceptions \
  -I"$VENDOR" \
  "$ROOT/native/src/rugo_wasm_entry.cpp" \
  "$VENDOR/metadata.cpp" \
  "$VENDOR/bloom_filter.cpp" \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=RugoWasm \
  -sENVIRONMENT=node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_wasm_alloc,_wasm_free,_read_parquet_metadata_json,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPU8 \
  -o "$OUT_DIR/rugo.js"

echo "wrote $OUT_DIR/rugo.js + $OUT_DIR/rugo.wasm"
