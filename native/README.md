# native/

This directory vendors a pinned subset of opteryx-core's C++ sources — the
Python-free Parquet reader (`rugo/src/parquet/*.cpp,.hpp`) and the draken
vector core it depends on (`draken/core`, `draken/ops`, vendored zstd/lz4).
No Cython, no nanobind, no libpython — see `sync-vendor.sh`.

Status: **not yet vendored.** `VENDOR_COMMIT` records the opteryx-core commit
this project intends to sync against; the actual source copy and the
`rugo_wasm_entry.cpp` C-ABI entry point land in Phase 1.

## Syncing

```
scripts/sync-vendor.sh /path/to/opteryx-core
```

This copies the pinned files from a local opteryx-core checkout into
`native/vendor/`, and fails loudly if the checkout's HEAD doesn't match
`VENDOR_COMMIT` (pass `--any-commit` to copy anyway and inspect the diff
yourself before bumping the pin). It never edits opteryx-core, and it never
silently re-pins — bumping `VENDOR_COMMIT` is a manual, reviewed step.

## License

The vendored files are Apache-2.0 (opteryx-core). Their NOTICE/LICENSE terms
carry forward into this repo's `LICENSE`.
