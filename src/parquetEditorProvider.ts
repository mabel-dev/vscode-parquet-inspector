import * as vscode from "vscode";
import { readParquetMetadata, type RowGroupStats } from "./native/rugoWasm";

export class ParquetEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "parquetInspector.parquetView";

  static register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      ParquetEditorProvider.viewType,
      new ParquetEditorProvider(),
      { supportsMultipleEditorsPerDocument: false }
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: false };
    webviewPanel.webview.html = renderLoading(document.uri);

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(document.uri);
    } catch (err) {
      webviewPanel.webview.html = renderError(document.uri, `Could not read file: ${String(err)}`);
      return;
    }

    const result = await readParquetMetadata(bytes);
    if (!result.ok) {
      webviewPanel.webview.html = renderError(document.uri, result.error);
      return;
    }

    webviewPanel.webview.html = renderMetadata(document.uri, result.metadata.num_rows, result.metadata.row_groups);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageCss(): string {
  return `
    body { font-family: var(--vscode-font-family); padding: 0 1.5rem 2rem; overflow-x: hidden; }
    h2, h3 { font-weight: 600; }
    .table-scroll { overflow-x: auto; margin-bottom: 1.5rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.85em; }
    th, td { text-align: left; padding: 2px 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); white-space: nowrap; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
    .muted { color: var(--vscode-descriptionForeground); }
  `;
}

function renderLoading(uri: vscode.Uri): string {
  return `<!DOCTYPE html><html><head><style>${pageCss()}</style></head><body>
    <h2>Rugo Parquet Inspector</h2>
    <p class="muted">Reading ${escapeHtml(uri.fsPath)}...</p>
  </body></html>`;
}

function renderError(uri: vscode.Uri, message: string): string {
  return `<!DOCTYPE html><html><head><style>${pageCss()}</style></head><body>
    <h2>Rugo Parquet Inspector</h2>
    <p><code>${escapeHtml(uri.fsPath)}</code></p>
    <p class="warn">Failed to read metadata: ${escapeHtml(message)}</p>
  </body></html>`;
}

function rowGroupSummaryRow(rg: RowGroupStats, index: number): string {
  return `<tr>
    <td>${index}</td>
    <td>${rg.num_rows}</td>
    <td>${rg.total_byte_size}</td>
    <td>${rg.columns.length}</td>
  </tr>`;
}

interface ColumnAcrossRowGroups {
  name: string;
  physicalTypes: Set<string>;
  logicalTypes: Set<string>;
  numValues: number;
  nullCount: number;
  compressedSize: number;
  uncompressedSize: number;
  codecs: Set<string>;
  encodingSets: Set<string>; // one entry per distinct (sorted) encoding combination seen
  rowGroupsWithDictionary: number;
  rowGroupsWithBloomFilter: number;
  rowGroupCount: number;
}

function combineColumnsAcrossRowGroups(rowGroups: RowGroupStats[]): ColumnAcrossRowGroups[] {
  const byName = new Map<string, ColumnAcrossRowGroups>();

  for (const rg of rowGroups) {
    for (const c of rg.columns) {
      let acc = byName.get(c.name);
      if (!acc) {
        acc = {
          name: c.name,
          physicalTypes: new Set(),
          logicalTypes: new Set(),
          numValues: 0,
          nullCount: 0,
          compressedSize: 0,
          uncompressedSize: 0,
          codecs: new Set(),
          encodingSets: new Set(),
          rowGroupsWithDictionary: 0,
          rowGroupsWithBloomFilter: 0,
          rowGroupCount: 0,
        };
        byName.set(c.name, acc);
      }
      acc.physicalTypes.add(c.physical_type);
      acc.logicalTypes.add(c.logical_type);
      acc.numValues += c.num_values;
      acc.nullCount += c.null_count;
      acc.compressedSize += c.total_compressed_size;
      acc.uncompressedSize += c.total_uncompressed_size;
      acc.codecs.add(c.codec);
      acc.encodingSets.add([...c.encodings].sort().join(","));
      if (c.encodings.includes("RLE_DICTIONARY") || c.encodings.includes("PLAIN_DICTIONARY")) {
        acc.rowGroupsWithDictionary += 1;
      }
      if (c.has_bloom_filter) {
        acc.rowGroupsWithBloomFilter += 1;
      }
      acc.rowGroupCount += 1;
    }
  }

  return [...byName.values()];
}

function combinedColumnRow(c: ColumnAcrossRowGroups): string {
  const notes: string[] = [];

  if (c.rowGroupsWithDictionary === 0) {
    notes.push("no dictionary");
  } else if (c.rowGroupsWithDictionary < c.rowGroupCount) {
    notes.push(`dictionary missing in ${c.rowGroupCount - c.rowGroupsWithDictionary}/${c.rowGroupCount} row groups`);
  }

  if (c.rowGroupsWithBloomFilter === 0) {
    notes.push("no bloom filter");
  } else if (c.rowGroupsWithBloomFilter < c.rowGroupCount) {
    notes.push(`bloom filter missing in ${c.rowGroupCount - c.rowGroupsWithBloomFilter}/${c.rowGroupCount} row groups`);
  }

  if (c.codecs.size > 1) {
    notes.push(`codec varies across row groups (${[...c.codecs].join(", ")})`);
  }
  if (c.encodingSets.size > 1) {
    notes.push("encodings vary across row groups");
  }
  if (c.physicalTypes.size > 1) {
    notes.push(`physical type varies across row groups (${[...c.physicalTypes].join(", ")})`);
  }

  const ratio = c.compressedSize > 0 ? (c.uncompressedSize / c.compressedSize).toFixed(2) : "-";

  return `<tr>
    <td>${escapeHtml(c.name)}</td>
    <td>${escapeHtml([...c.physicalTypes].join(", "))}</td>
    <td>${escapeHtml([...c.logicalTypes].join(", "))}</td>
    <td>${c.numValues}</td>
    <td>${c.nullCount}</td>
    <td>${escapeHtml([...c.codecs].join(", "))}</td>
    <td>${escapeHtml([...c.encodingSets].map((s) => s.split(",").join(", ")).join(" | "))}</td>
    <td>${c.compressedSize} / ${c.uncompressedSize} (${ratio}x)</td>
    <td class="${notes.length ? "warn" : ""}">${escapeHtml(notes.join("; "))}</td>
  </tr>`;
}

function renderMetadata(uri: vscode.Uri, numRows: number, rowGroups: RowGroupStats[]): string {
  const rgWarning =
    rowGroups.length === 1 && numRows > 100_000
      ? `<p class="warn">Single row group for ${numRows} rows — no row-group-level pruning is possible on this file.</p>`
      : "";

  const rgRows = rowGroups.map(rowGroupSummaryRow).join("\n");
  const columnRows = combineColumnsAcrossRowGroups(rowGroups).map(combinedColumnRow).join("\n");

  return `<!DOCTYPE html><html><head><style>${pageCss()}</style></head><body>
    <h2>Rugo Parquet Inspector</h2>
    <p><code>${escapeHtml(uri.fsPath)}</code></p>
    <p>${numRows} rows across ${rowGroups.length} row group(s)</p>
    ${rgWarning}

    <h3>Row groups</h3>
    <div class="table-scroll">
    <table>
      <thead><tr><th>#</th><th>Rows</th><th>Bytes</th><th>Columns</th></tr></thead>
      <tbody>${rgRows}</tbody>
    </table>
    </div>

    <h3>Columns (combined across all row groups)</h3>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>Column</th><th>Physical</th><th>Logical</th><th>Values</th><th>Nulls</th>
        <th>Codec</th><th>Encodings</th><th>Compressed / Uncompressed</th><th>Notes</th>
      </tr></thead>
      <tbody>${columnRows}</tbody>
    </table>
    </div>
  </body></html>`;
}
