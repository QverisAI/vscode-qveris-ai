import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ViewStateManager } from './stateManager';
import { HomeViewProvider } from './homeViewProvider';
import { ToolSearchViewProvider } from './toolSearchViewProvider';
import { FeaturedToolsViewProvider } from './featuredToolsViewProvider';
import { ToolSpecificationViewProvider } from './toolSpecificationViewProvider';
import { copyCursorPrompt, openCursorPromptDoc, maybeEnsureCursorPromptInRules, ensureMcpConfigWithStoredKey, secretKeyName, globalStateKey } from './utils';

let stateManager: ViewStateManager;

async function getExtensionVersion(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(context.extensionPath, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version;
  } catch {
    return undefined;
  }
}

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

  // Check if this is a new installation or update by comparing extension version
  const currentVersion = await getExtensionVersion(context);
  const storedVersion = context.globalState.get<string>(globalStateKey('extensionVersion'));
  const isNewInstallOrUpdate = !storedVersion || storedVersion !== currentVersion;
  
  // Update stored version
  if (currentVersion) {
    await context.globalState.update(globalStateKey('extensionVersion'), currentVersion);
  }

  // Execute installation tasks immediately on activation
  // Force replace rule files if this is a new installation or update
  await ensureMcpConfigWithStoredKey(context);
  await maybeEnsureCursorPromptInRules(context, isNewInstallOrUpdate);

  // Also listen for workspace folder changes to ensure rules are installed when workspace becomes available
  const ensureRulesOnWorkspaceChange = async () => {
    await maybeEnsureCursorPromptInRules(context, false);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await ensureRulesOnWorkspaceChange();
    })
  );
}

export function deactivate() {
  // Nothing to cleanup
}
