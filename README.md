# Rugo Parquet Inspector

A VS Code extension for inspecting Parquet files below the "just show me a
data grid" level — schema, row-group and column-chunk layout, encoding,
compression, statistics, dictionary/bloom-filter presence, and common
anti-patterns (uncompacted row groups, missing dictionary/bloom coverage,
encodings that vary across row groups). Also previews CSV/JSONL as a
separate, independent editor (no relation to the Parquet metadata engine).

Parquet reading is powered by [Rugo](https://github.com/mabel-dev/opteryx-core/tree/main/rugo),
opteryx-core's Parquet/file engine. The core is not reimplemented here: it's
a pinned, vendored copy of Rugo's Python-free C++ metadata reader
(`rugo/src/parquet`), compiled to WASM with no Cython/nanobind/libpython
involved. See [`native/README.md`](native/README.md).

## Status

Phase 1 done — real metadata reads (schema, row groups, column-chunk stats,
bloom-filter presence) working end to end against real files. CSV/JSONL is
still a placeholder (Phase 3).

## Development

```
npm install
npm run build:native   # requires emcc (brew install emscripten)
npm run watch           # esbuild watch mode
```

Then launch the "Run Extension" debug target in VS Code (F5).

## Phases

- **Phase 0** — extension scaffolding.
- **Phase 1** — native core vendored + compiled to WASM; metadata-only read
  (schema, row groups, column-chunk stats) working end to end. Done.
- **Phase 2** — full Parquet inspector UI polish: schema tree, paginated data
  preview, richer anti-pattern lint.
- **Phase 3** — independent CSV/JSONL preview (pure TS, no native dependency).
- **Phase 4** — branding/icon, CI packaging, Marketplace publish.

## License

Apache-2.0. Includes vendored Apache-2.0 code from opteryx-core/Rugo — see
`native/README.md` for provenance.
