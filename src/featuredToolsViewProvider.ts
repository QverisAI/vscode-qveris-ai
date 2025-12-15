import * as vscode from 'vscode';
import { ViewStateManager } from './stateManager';
import { getNonce } from './utils';

// Featured Tools View Provider
export class FeaturedToolsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateManager: ViewStateManager
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    // Set view to collapsed by default
    webviewView.show(false);
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return /* html */`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
          .status { font-size: 12px; color: var(--vscode-descriptionForeground); }
        </style>
      </head>
      <body>
        <div class="status">No featured tools available.</div>
      </body>
      </html>
    `;
  }
}

