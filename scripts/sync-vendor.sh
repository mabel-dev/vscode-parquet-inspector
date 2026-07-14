#!/usr/bin/env bash
# Copies the pinned subset of opteryx-core C++ sources into native/vendor/.
# Fails loudly on any mismatch or missing input rather than silently
# vendoring the wrong thing.
set -euo pipefail

ANY_COMMIT=0
if [[ "${1:-}" == "--any-commit" ]]; then
  ANY_COMMIT=1
  shift
fi

SRC_REPO="${1:-}"
if [[ -z "$SRC_REPO" ]]; then
  echo "usage: sync-vendor.sh [--any-commit] /path/to/opteryx-core" >&2
  exit 1
fi
if [[ ! -d "$SRC_REPO/.git" ]]; then
  echo "error: $SRC_REPO is not a git checkout" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$ROOT/native/VENDOR_COMMIT"
PINNED_COMMIT="$(awk '{print $2}' "$PIN_FILE")"
ACTUAL_COMMIT="$(git -C "$SRC_REPO" rev-parse --short HEAD)"

if [[ "$ANY_COMMIT" -eq 0 && "$ACTUAL_COMMIT" != "$PINNED_COMMIT"* ]]; then
  echo "error: $SRC_REPO HEAD is $ACTUAL_COMMIT, but native/VENDOR_COMMIT pins $PINNED_COMMIT" >&2
  echo "       pass --any-commit to copy anyway, then update VENDOR_COMMIT deliberately" >&2
  exit 1
fi

# Files to vendor. Phase 1 scope is metadata-only (schema, row groups,
# column-chunk stats, bloom-filter presence) — it does NOT touch
# decode_column.cpp, which pulls in a real std::thread-based thread pool
# (thread_pool.hpp) for page-level parallelism and would need Emscripten
# pthreads + cross-origin isolation to compile to WASM. That's deliberately
# deferred to Phase 2, when actual data decode is needed for the preview
# grid — surface it again then rather than quietly threading it through here.
#
# metadata.cpp/bloom_filter.cpp have zero draken dependency, so draken is
# not vendored in Phase 1 either.
#
# Keep this list in sync with what rugo_wasm_entry.cpp actually #includes.
FILES=(
  "rugo/src/parquet/metadata.cpp"
  "rugo/src/parquet/metadata.hpp"
  "rugo/src/parquet/thrift.hpp"
  "rugo/src/parquet/bloom_filter.cpp"
)

DEST="$ROOT/native/vendor"
rm -rf "$DEST"
mkdir -p "$DEST"

for f in "${FILES[@]}"; do
  if [[ ! -e "$SRC_REPO/$f" ]]; then
    echo "error: expected file/dir missing from source repo: $f" >&2
    exit 1
  fi
  mkdir -p "$DEST/$(dirname "$f")"
  cp -R "$SRC_REPO/$f" "$DEST/$f"
done

echo "vendored ${#FILES[@]} paths from opteryx-core @ $ACTUAL_COMMIT into native/vendor/"
