import * as vscode from "vscode";

/**
 * Phase 0 stub for CSV/JSONL preview (Phase 3). No parser wired in yet.
 */
export class TabularEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "parquetInspector.tabularView";

  static register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      TabularEditorProvider.viewType,
      new TabularEditorProvider(),
      { supportsMultipleEditorsPerDocument: false }
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): void {
    webviewPanel.webview.options = { enableScripts: false };
    webviewPanel.webview.html = this.renderPlaceholder(document.uri);
  }

  private renderPlaceholder(uri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html>
<body>
  <h2>Parquet Inspector — CSV/JSONL preview</h2>
  <p>Parser is not wired in yet (Phase 3).</p>
  <p><code>${uri.fsPath}</code></p>
</body>
</html>`;
  }
}
