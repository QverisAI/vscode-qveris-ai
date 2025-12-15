import * as vscode from 'vscode';
import { ViewStateManager } from './stateManager';
import { HomeViewProvider } from './homeViewProvider';
import { ToolSearchViewProvider } from './toolSearchViewProvider';
import { FeaturedToolsViewProvider } from './featuredToolsViewProvider';
import { ToolSpecificationViewProvider } from './toolSpecificationViewProvider';
import { copyCursorPrompt, openCursorPromptDoc, maybeEnsureCursorPromptInRules, ensureMcpConfigWithStoredKey, secretKeyName } from './utils';

let stateManager: ViewStateManager;

export async function activate(context: vscode.ExtensionContext) {
  stateManager = new ViewStateManager(context);

  const homeProvider = new HomeViewProvider(context, stateManager);
  const toolSearchProvider = new ToolSearchViewProvider(context, stateManager);
  const featuredToolsProvider = new FeaturedToolsViewProvider(context, stateManager);
  const toolSpecificationProvider = new ToolSpecificationViewProvider(context, stateManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('qverisAi.home', homeProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.toolSearch', toolSearchProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.featuredTools', featuredToolsProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.toolSpecification', toolSpecificationProvider),
    vscode.commands.registerCommand('vscode-qveris-ai.openWebsite', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://qveris.ai/'));
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.copyApiKey', async () => {
      const key = await context.secrets.get(secretKeyName('qverisApiKey'));
      if (!key) {
        vscode.window.showWarningMessage('No Qveris API key stored yet. Please sign in first.');
        return;
      }
      await vscode.env.clipboard.writeText(key);
      vscode.window.showInformationMessage('Qveris API key copied to clipboard.');
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.copyCursorPrompt', async () => {
      await copyCursorPrompt(context, false);
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.openCursorPromptDoc', async () => {
      await openCursorPromptDoc();
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.refreshSession', async () => {
      await stateManager.notifyLoginStateChanged();
    })
  );

  await maybeEnsureCursorPromptInRules(context);
  await ensureMcpConfigWithStoredKey(context);
}

export function deactivate() {
  // Nothing to cleanup
}
