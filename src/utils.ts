import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CURSOR_PROMPT } from './constants';

export function maskKey(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function getNonce() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function isCursorApp() {
  return !!process.env.CURSOR || (vscode.env.appName || '').toLowerCase().includes('cursor');
}

export function secretKeyName(base: string) {
  return `${base}.${isCursorApp() ? 'cursor' : 'vscode'}`;
}

export function globalStateKey(base: string) {
  return `${base}.${isCursorApp() ? 'cursor' : 'vscode'}`;
}

export async function getStoredEmail(context: vscode.ExtensionContext) {
  const secretEmail = await context.secrets.get(secretKeyName('qverisEmail'));
  if (secretEmail) return secretEmail;
  return context.globalState.get<string>(globalStateKey('qverisEmail'));
}

export function getMcpConfigPaths() {
  if (isCursorApp()) {
    return [path.join(os.homedir(), '.cursor', 'mcp.json')];
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    return [path.join(workspaceFolder.uri.fsPath, '.vscode', 'mcp.json')];
  }

  // Fallback to ~/.cursor for non-workspace scenarios
  return [path.join(os.homedir(), '.cursor', 'mcp.json')];
}

export function getAllKnownMcpPaths() {
  const paths = [path.join(os.homedir(), '.cursor', 'mcp.json')];
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    paths.push(path.join(workspaceFolder.uri.fsPath, '.vscode', 'mcp.json'));
  }
  return Array.from(new Set(paths));
}

export async function writeMcpConfigFile(mcpPath: string, apiKey: string) {
  await fs.mkdir(path.dirname(mcpPath), { recursive: true });
  let data: any = {};
  try {
    const raw = await fs.readFile(mcpPath, 'utf8');
    data = JSON.parse(raw || '{}');
  } catch {
    data = {};
  }

  if (!data.mcpServers || typeof data.mcpServers !== 'object') {
    data.mcpServers = {};
  }

  const existing = data.mcpServers.qveris || {};
  const existingEnv = existing.env || {};

  data.mcpServers.qveris = {
    command: existing.command || 'npx',
    args: existing.args || ['@qverisai/sdk'],
    env: {
      ...existingEnv,
      QVERIS_API_KEY: apiKey
    }
  };

  await fs.writeFile(mcpPath, JSON.stringify(data, null, 2), 'utf8');
}

export async function readApiKeyFromMcpConfigs(): Promise<string | undefined> {
  const mcpPaths = getAllKnownMcpPaths();
  for (const mcpPath of mcpPaths) {
    try {
      const raw = await fs.readFile(mcpPath, 'utf8');
      const data = JSON.parse(raw || '{}');
      const key = data?.mcpServers?.qveris?.env?.QVERIS_API_KEY;
      if (typeof key === 'string' && key.trim()) {
        return key.trim();
      }
    } catch {
      // ignore and try next path
    }
  }
  return undefined;
}

export async function ensureMcpConfigWithStoredKey(context: vscode.ExtensionContext) {
  let apiKey = await context.secrets.get(secretKeyName('qverisApiKey'));
  if (!apiKey) {
    apiKey = await readApiKeyFromMcpConfigs();
    if (apiKey) {
      await context.secrets.store(secretKeyName('qverisApiKey'), apiKey);
    }
  }
  if (!apiKey) return;
  await ensureMcpConfigWithApiKey(apiKey);
}

export async function ensureMcpConfigWithApiKey(apiKey: string) {
  if (!apiKey) return;
  const mcpPaths = getMcpConfigPaths();

  const results = await Promise.all(mcpPaths.map(async (mcpPath) => {
    try {
      await writeMcpConfigFile(mcpPath, apiKey);
      return { mcpPath, ok: true as const };
    } catch (error: any) {
      return { mcpPath, ok: false as const, error };
    }
  }));

  const succeeded = results.filter(r => r.ok).map(r => r.mcpPath);
  const failed = results.filter(r => !r.ok);

  if (succeeded.length > 0) {
    vscode.window.showInformationMessage(`Qveris MCP configuration updated (${succeeded.join(', ')}).`);
  }

  if (failed.length > 0) {
    const [first] = failed;
    vscode.window.showErrorMessage(`Failed to update Qveris MCP config at ${failed.map(f => f.mcpPath).join(', ')}: ${first?.error?.message || first?.error}`);
  }
}

export async function copyCursorPrompt(context: vscode.ExtensionContext, markCopied: boolean) {
  const prompt = CURSOR_PROMPT;
  try {
    await vscode.env.clipboard.writeText(prompt);
    if (markCopied) {
      await context.globalState.update('qverisCursorPromptCopied', true);
    }
    vscode.window.showInformationMessage('Qveris MCP prompt copied to clipboard for this workspace rules file.');
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to copy Qveris prompt: ${error?.message || error}`);
  }
}

export async function openCursorPromptDoc() {
  const doc = await vscode.workspace.openTextDocument({
    content: CURSOR_PROMPT,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage('Qveris MCP prompt opened. Save or paste it into a workspace rules file.');
}

function expandHome(filePath: string) {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function resolveRulesPath(filePath: string, workspaceRoot: string) {
  const expanded = expandHome(filePath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.join(workspaceRoot, expanded);
}

function buildRulesFileContent(existing: string) {
  if (!existing.trim()) {
    return ['---', 'alwaysApply: true', '---', '', '<context>' + CURSOR_PROMPT + '</context>', ''].join('\n');
  }

  const needsGap = existing && !existing.endsWith('\n');
  return existing + (needsGap ? '\n\n' : '\n') + '<context>' + CURSOR_PROMPT + '</context>' + '\n';
}

export async function maybeEnsureCursorPromptInRules(context: vscode.ExtensionContext) {
  if (!isCursorApp()) return;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const config = vscode.workspace.getConfiguration('qverisAi');
  const rulesPathRaw = config.get<string>('cursorRulesPath')?.trim() || '.cursor/rules/qveris.mdc';
  const rulesPath = resolveRulesPath(rulesPathRaw, workspaceRoot);

  try {
    const existing = await fs.readFile(rulesPath, 'utf8').catch(() => '');
    if (existing.includes(CURSOR_PROMPT)) {
      await context.globalState.update('qverisCursorPromptCopied', true);
      return;
    }

    const dir = path.dirname(rulesPath);
    await fs.mkdir(dir, { recursive: true });

    const newContent = buildRulesFileContent(existing);

    await fs.writeFile(rulesPath, newContent, 'utf8');
    await context.globalState.update('qverisCursorPromptCopied', true);
    vscode.window.showInformationMessage('Qveris MCP prompt written to this workspace rules file.');
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to write Qveris prompt to workspace rules: ${error?.message || error}`);
  }
}

