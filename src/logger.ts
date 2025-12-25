import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;
let isTestModeFlag: boolean = true;

export function initializeLogger(context: vscode.ExtensionContext) {
  isTestModeFlag = context.extensionMode === vscode.ExtensionMode.Development;
  outputChannel = vscode.window.createOutputChannel('Qveris AI');
}

export function isTestMode(): boolean {
  return isTestModeFlag;
}

export function log(message: string) {
  // Always log to console
  console.log(message);
  
  // Always log to output channel so users can see it
  // If outputChannel is not initialized yet, create it
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Qveris AI');
  }
  outputChannel.appendLine(message);
  
  // In development mode, automatically show the output channel
  // so developers can see logs immediately
  if (isTestModeFlag) {
    outputChannel.show(true); // true = preserve focus
  }
}
