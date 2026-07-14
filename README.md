# Rugo Parquet Inspector

A VS Code extension for inspecting Parquet files below the "just show me a
data grid" level — schema, row-group and column-chunk layout, encoding,
compression, statistics, dictionary/bloom-filter presence, and common
anti-patterns (uncompacted row groups, missing dictionary/bloom coverage,
encodings that vary across row groups).

Parquet reading is powered by [Rugo](https://rugo.dev),
opteryx-core's Parquet/file engine. The core is not reimplemented here: it's
a pinned, vendored copy of Rugo's Python-free C++ metadata reader
(`rugo/src/parquet`), compiled to WASM with no Cython/nanobind/libpython
involved. See [`native/README.md`](native/README.md).

## Status

Real metadata reads (schema, row groups, column-chunk stats, bloom-filter
presence) working end to end against real files.

## Development

```
npm install
npm run build:native   # requires emcc (brew install emscripten)
npm run watch           # esbuild watch mode
```

Then launch the "Run Extension" debug target in VS Code (F5).

## License

Apache-2.0. Includes vendored Apache-2.0 code from opteryx-core/Rugo — see
`native/README.md` for provenance.
