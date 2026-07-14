import * as vscode from "vscode";
import { ParquetEditorProvider } from "./parquetEditorProvider";
import { TabularEditorProvider } from "./tabularEditorProvider";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(ParquetEditorProvider.register());
  context.subscriptions.push(TabularEditorProvider.register());
}

export function deactivate(): void {
  // no-op: providers are disposed via context.subscriptions
}
