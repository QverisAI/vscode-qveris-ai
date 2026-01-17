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

export function isTraeApp() {
  return (vscode.env.appName || '').toLowerCase().includes('trae');
}

export function isKiroApp() {
  return (vscode.env.appName || '').toLowerCase().includes('kiro');
}

export function isCodebuddyApp() {
  return (vscode.env.appName || '').toLowerCase().includes('codebuddy');
}

export function isLingmaApp() {
  return (vscode.env.appName || '').toLowerCase().includes('lingma');
}

export function getIdeScheme(): 'vscode' | 'cursor' | 'trae' | 'kiro' | 'codebuddy' | 'lingma' {
  if (isTraeApp()) {
    return 'trae';
  }
  if (isCursorApp()) {
    return 'cursor';
  }
  if (isKiroApp()) {
    return 'kiro';
  }
  if (isCodebuddyApp()) {
    return 'codebuddy';
  }
  if (isLingmaApp()) {
    return 'lingma';
  }
  return 'vscode';
}

export function secretKeyName(base: string) {
  const ideType = getIdeScheme();
  return `${base}.${ideType}`;
}

export function globalStateKey(base: string) {
  const ideType = getIdeScheme();
  return `${base}.${ideType}`;
}

export function generateOAuthState(): string {
  const schema = getIdeScheme();
  const random = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return `${schema}-${random}`;
}

export function generateSessionId(): string {
  const schema = getIdeScheme();
  const random = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return `${schema}-${random}`;
}

export function generateSearchId(): string {
  const schema = getIdeScheme();
  const random = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return `${schema}-${random}`;
}

export function isToolId(query: string): boolean {
  if (!query || !query.trim()) return false;
  const trimmed = query.trim();
  // tool_id规则：不带空格，以"."分隔，能获取到至少4个不为空的item
  if (trimmed.includes(' ')) return false;
  const parts = trimmed.split('.');
  return parts.length >= 4 && parts.every(part => part && part.trim().length > 0);
}

export async function getStoredEmail(context: vscode.ExtensionContext) {
  const secretEmail = await context.secrets.get(secretKeyName('qverisEmail'));
  if (secretEmail) return secretEmail;
  return context.globalState.get<string>(globalStateKey('qverisEmail'));
}

function getTraeMcpConfigPath(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    // Windows: %APPDATA%\Trae\User\mcp.json
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Trae', 'User', 'mcp.json');
  } else if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/Trae/User/mcp.json
    return path.join(os.homedir(), 'Library', 'Application Support', 'Trae', 'User', 'mcp.json');
  } else {
    // Linux: ~/.trae-server/data/Machine/mcp.json
    return path.join(os.homedir(), '.trae-server', 'data', 'Machine', 'mcp.json');
  }
}

function getLingmaMcpConfigPath(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    // Windows: %APPDATA%\Lingma\SharedClientCache\mcp.json
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Lingma', 'SharedClientCache', 'mcp.json');
  } else {
    // Linux and macOS: ~/.config/Lingma/SharedClientCache/mcp.json
    return path.join(os.homedir(), '.config', 'Lingma', 'SharedClientCache', 'mcp.json');
  }
}

export function getMcpConfigPaths() {
  if (isTraeApp()) {
    return [getTraeMcpConfigPath()];
  }
  
  if (isCursorApp()) {
    return [path.join(os.homedir(), '.cursor', 'mcp.json')];
  }

  if (isKiroApp()) {
    return [path.join(os.homedir(), '.kiro', 'settings', 'mcp.json')];
  }

  if (isCodebuddyApp()) {
    return [path.join(os.homedir(), '.codebuddy', 'mcp.json')];
  }

  if (isLingmaApp()) {
    return [getLingmaMcpConfigPath()];
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    return [path.join(workspaceFolder.uri.fsPath, '.vscode', 'mcp.json')];
  }

  // Fallback to ~/.cursor for non-workspace scenarios
  return [path.join(os.homedir(), '.cursor', 'mcp.json')];
}

export function getAllKnownMcpPaths() {
  const paths = [
    path.join(os.homedir(), '.cursor', 'mcp.json'),
    getTraeMcpConfigPath(),
    path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
    path.join(os.homedir(), '.codebuddy', 'mcp.json'),
    getLingmaMcpConfigPath()
  ];
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

  // Determine if this is a Cursor/Trae/Kiro/Codebuddy/Lingma config or VS Code config
  // Cursor config is in ~/.cursor/mcp.json
  // Trae config location varies by OS: Windows (%APPDATA%\Trae\User\mcp.json), macOS (~/Library/Application Support/Trae/User/mcp.json), Linux (~/.trae-server/data/Machine/mcp.json)
  // Kiro config is in ~/.kiro/settings/mcp.json
  // Codebuddy config is in ~/.codebuddy/mcp.json
  // Lingma config location varies by OS: Windows (%APPDATA%\Lingma\SharedClientCache\mcp.json), Linux/macOS (~/.config/Lingma/SharedClientCache/mcp.json)
  // VS Code config is in workspace/.vscode/mcp.json
  const isCursorConfig = mcpPath.includes('.cursor') && !mcpPath.includes('.vscode');
  const isTraeConfig = mcpPath.includes('Trae') || mcpPath.includes('.trae-server');
  const isKiroConfig = mcpPath.includes('.kiro');
  const isCodebuddyConfig = mcpPath.includes('.codebuddy');
  const isLingmaConfig = mcpPath.includes('Lingma');
  const configKey = (isCursorConfig || isTraeConfig || isKiroConfig || isCodebuddyConfig || isLingmaConfig) ? 'mcpServers' : 'servers';

  // Use appropriate key based on config type
  if (!data[configKey] || typeof data[configKey] !== 'object') {
    data[configKey] = {};
  }

  // Preserve all existing servers, only update qveris
  const existing = data[configKey].qveris || {};
  const existingEnv = existing.env || {};

  data[configKey].qveris = {
    command: existing.command || 'npx',
    args: existing.args || ['@qverisai/mcp'],
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
      
      // Determine if this is a Cursor/Trae/Kiro config or VS Code config
      // Cursor config is in ~/.cursor/mcp.json
      // Trae config location varies by OS: Windows (%APPDATA%\Trae\User\mcp.json), macOS (~/Library/Application Support/Trae/User/mcp.json), Linux (~/.trae-server/data/Machine/mcp.json)
      // Kiro config is in ~/.kiro/settings/mcp.json
      // VS Code config is in workspace/.vscode/mcp.json
      const isCursorConfig = mcpPath.includes('.cursor') && !mcpPath.includes('.vscode');
      const isTraeConfig = mcpPath.includes('Trae') || mcpPath.includes('.trae-server');
      const isKiroConfig = mcpPath.includes('.kiro');
      const configKey = (isCursorConfig || isTraeConfig || isKiroConfig) ? 'mcpServers' : 'servers';
      
      // Try the appropriate key first, then fallback for backward compatibility
      const key = data?.[configKey]?.qveris?.env?.QVERIS_API_KEY || 
                  ((isCursorConfig || isTraeConfig) ? data?.servers?.qveris?.env?.QVERIS_API_KEY : data?.mcpServers?.qveris?.env?.QVERIS_API_KEY);
      // Ignore placeholder values that indicate user needs to login
      if (typeof key === 'string' && key.trim() && key.trim() !== 'LOGIN_TO_FETCH_APIKEY') {
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

export async function clearQverisApiKeyFromMcpConfigs(): Promise<string[]> {
  const mcpPaths = getAllKnownMcpPaths();
  const clearedPaths: string[] = [];
  const placeholderValue = 'LOGIN_TO_FETCH_APIKEY';

  for (const mcpPath of mcpPaths) {
    try {
      // Check if file exists
      await fs.access(mcpPath);
      
      const raw = await fs.readFile(mcpPath, 'utf8');
      const data = JSON.parse(raw || '{}');
      
      // Determine if this is a Cursor/Trae/Kiro config or VS Code config
      // Cursor config is in ~/.cursor/mcp.json
      // Trae config location varies by OS: Windows (%APPDATA%\Trae\User\mcp.json), macOS (~/Library/Application Support/Trae/User/mcp.json), Linux (~/.trae-server/data/Machine/mcp.json)
      // Kiro config is in ~/.kiro/settings/mcp.json
      // VS Code config is in workspace/.vscode/mcp.json
      const isCursorConfig = mcpPath.includes('.cursor') && !mcpPath.includes('.vscode');
      const isTraeConfig = mcpPath.includes('Trae') || mcpPath.includes('.trae-server');
      const isKiroConfig = mcpPath.includes('.kiro');
      const configKey = (isCursorConfig || isTraeConfig || isKiroConfig) ? 'mcpServers' : 'servers';
      
      // Check if qveris exists in the config
      if (data[configKey] && data[configKey].qveris) {
        // Set API key to placeholder value instead of deleting it
        if (!data[configKey].qveris.env) {
          data[configKey].qveris.env = {};
        }
        data[configKey].qveris.env.QVERIS_API_KEY = placeholderValue;
        
        // Write back the updated config
        await fs.writeFile(mcpPath, JSON.stringify(data, null, 2), 'utf8');
        clearedPaths.push(mcpPath);
      }
    } catch (error: any) {
      // If file doesn't exist or can't be read, skip it
      // This is expected for some paths that may not exist
      continue;
    }
  }

  return clearedPaths;
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
  return ['---', 'description: Utilizing third-party APIs to retrieve and process data is applicable in various fields such as finance, economics, healthcare, sports, scientific research, and more', 'alwaysApply: false', '---', '', CURSOR_PROMPT, ''].join('\n');
}

function buildKiroRulesFileContent(existing: string) {
  return ['---', 'inclusion: always', '---', '', CURSOR_PROMPT, ''].join('\n');
}

function buildCodebuddyRulesFileContent(existing: string) {
  const now = new Date().toISOString();
  return ['---', 'description: ', 'alwaysApply: true', 'enabled: true', `updatedAt: ${now}`, 'provider: ', '---', '', CURSOR_PROMPT, ''].join('\n');
}

function buildLingmaRulesFileContent(existing: string) {
  return ['---', 'trigger: always_on', '---', '', CURSOR_PROMPT, ''].join('\n');
}

export async function maybeEnsureCursorPromptInRules(context: vscode.ExtensionContext, forceReplace: boolean = false, silent: boolean = false) {
  if (!isCursorApp()) return;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const config = vscode.workspace.getConfiguration('qverisAi');
  const rulesPathRaw = config.get<string>('cursorRulesPath')?.trim() || '.cursor/rules/qveris.mdc';
  const rulesPath = resolveRulesPath(rulesPathRaw, workspaceRoot);

  try {
    const existing = await fs.readFile(rulesPath, 'utf8').catch(() => '');
    
    // If forceReplace is true or file doesn't contain the prompt, write/update it
    if (forceReplace || !existing.includes(CURSOR_PROMPT)) {
      const dir = path.dirname(rulesPath);
      await fs.mkdir(dir, { recursive: true });

      const newContent = buildRulesFileContent(existing);

      await fs.writeFile(rulesPath, newContent, 'utf8');
      await context.globalState.update('qverisCursorPromptCopied', true);
      if (!silent) {
        if (forceReplace) {
          vscode.window.showInformationMessage('Qveris MCP prompt updated in workspace rules file.');
        } else {
          vscode.window.showInformationMessage('Qveris MCP prompt written to this workspace rules file.');
        }
      }
    } else {
      await context.globalState.update('qverisCursorPromptCopied', true);
    }
  } catch (error: any) {
    if (!silent) {
      vscode.window.showErrorMessage(`Failed to write Qveris prompt to workspace rules: ${error?.message || error}`);
    }
  }
}

export async function maybeEnsureTraePromptInRules(context: vscode.ExtensionContext, forceReplace: boolean = false, silent: boolean = false) {
  if (!isTraeApp()) return;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const rulesPath = path.join(workspaceRoot, '.trae', 'rules', 'qveris.md');

  try {
    const existing = await fs.readFile(rulesPath, 'utf8').catch(() => '');
    
    // If forceReplace is true or file doesn't contain the prompt, write/update it
    if (forceReplace || !existing.includes(CURSOR_PROMPT)) {
      const dir = path.dirname(rulesPath);
      await fs.mkdir(dir, { recursive: true });

      const newContent = buildRulesFileContent(existing);

      await fs.writeFile(rulesPath, newContent, 'utf8');
      await context.globalState.update('qverisTraePromptCopied', true);
      if (!silent) {
        if (forceReplace) {
          vscode.window.showInformationMessage('Qveris MCP prompt updated in workspace rules file.');
        } else {
          vscode.window.showInformationMessage('Qveris MCP prompt written to this workspace rules file.');
        }
      }
    } else {
      await context.globalState.update('qverisTraePromptCopied', true);
    }
  } catch (error: any) {
    if (!silent) {
      vscode.window.showErrorMessage(`Failed to write Qveris prompt to workspace rules: ${error?.message || error}`);
    }
  }
}

export async function maybeEnsureKiroPromptInRules(context: vscode.ExtensionContext, forceReplace: boolean = false, silent: boolean = false) {
  if (!isKiroApp()) return;

  const rulesPath = path.join(os.homedir(), '.kiro', 'steering', 'qveris.md');

  try {
    const existing = await fs.readFile(rulesPath, 'utf8').catch(() => '');
    
    // If forceReplace is true or file doesn't contain the prompt, write/update it
    if (forceReplace || !existing.includes(CURSOR_PROMPT)) {
      const dir = path.dirname(rulesPath);
      await fs.mkdir(dir, { recursive: true });

      const newContent = buildKiroRulesFileContent(existing);

      await fs.writeFile(rulesPath, newContent, 'utf8');
      await context.globalState.update('qverisKiroPromptCopied', true);
      if (!silent) {
        if (forceReplace) {
          vscode.window.showInformationMessage('Qveris MCP prompt updated in Kiro rules file.');
        } else {
          vscode.window.showInformationMessage('Qveris MCP prompt written to Kiro rules file.');
        }
      }
    } else {
      await context.globalState.update('qverisKiroPromptCopied', true);
    }
  } catch (error: any) {
    if (!silent) {
      vscode.window.showErrorMessage(`Failed to write Qveris prompt to Kiro rules: ${error?.message || error}`);
    }
  }
}

export async function maybeEnsureCodebuddyPromptInRules(context: vscode.ExtensionContext, forceReplace: boolean = false, silent: boolean = false) {
  if (!isCodebuddyApp()) return;

  const rulesPath = path.join(os.homedir(), '.codebuddy', 'rules', 'qveris.mdc');

  try {
    const existing = await fs.readFile(rulesPath, 'utf8').catch(() => '');
    
    // If forceReplace is true or file doesn't contain the prompt, write/update it
    if (forceReplace || !existing.includes(CURSOR_PROMPT)) {
      const dir = path.dirname(rulesPath);
      await fs.mkdir(dir, { recursive: true });

      const newContent = buildCodebuddyRulesFileContent(existing);

      await fs.writeFile(rulesPath, newContent, 'utf8');
      await context.globalState.update('qverisCodebuddyPromptCopied', true);
      if (!silent) {
        if (forceReplace) {
          vscode.window.showInformationMessage('QVeris MCP prompt updated in Codebuddy rules file.');
        } else {
          vscode.window.showInformationMessage('QVeris MCP prompt written to Codebuddy rules file.');
        }
      }
    } else {
      await context.globalState.update('qverisCodebuddyPromptCopied', true);
    }
  } catch (error: any) {
    if (!silent) {
      vscode.window.showErrorMessage(`Failed to write QVeris prompt to Codebuddy rules: ${error?.message || error}`);
    }
  }
}

export async function maybeEnsureLingmaPromptInRules(context: vscode.ExtensionContext, forceReplace: boolean = false, silent: boolean = false) {
  if (!isLingmaApp()) return;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const rulesPath = path.join(workspaceRoot, '.lingma', 'rules', 'qveris.md');

  try {
    const existing = await fs.readFile(rulesPath, 'utf8').catch(() => '');
    
    // If forceReplace is true or file doesn't contain the prompt, write/update it
    if (forceReplace || !existing.includes(CURSOR_PROMPT)) {
      const dir = path.dirname(rulesPath);
      await fs.mkdir(dir, { recursive: true });

      const newContent = buildLingmaRulesFileContent(existing);

      await fs.writeFile(rulesPath, newContent, 'utf8');
      await context.globalState.update('qverisLingmaPromptCopied', true);
      if (!silent) {
        if (forceReplace) {
          vscode.window.showInformationMessage('QVeris MCP prompt updated in Lingma workspace rules file.');
        } else {
          vscode.window.showInformationMessage('QVeris MCP prompt written to Lingma workspace rules file.');
        }
      }
    } else {
      await context.globalState.update('qverisLingmaPromptCopied', true);
    }
  } catch (error: any) {
    if (!silent) {
      vscode.window.showErrorMessage(`Failed to write QVeris prompt to Lingma workspace rules: ${error?.message || error}`);
    }
  }
}

export async function maybeEnsureQverisApiRule(context: vscode.ExtensionContext, forceReplace: boolean = false) {
  if (!isCursorApp()) return;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const apiRulePath = path.join(workspaceRoot, '.cursor', 'rules', 'qveris_ai_api.mdc');

  try {
    // Read the qveris_api.md file from extension
    const extensionPath = context.extensionPath;
    const apiDocPath = path.join(extensionPath, 'src', 'qveris_api.md');
    const apiDocContent = await fs.readFile(apiDocPath, 'utf8');

    // Check if rule already exists and if we should replace it
    const existing = await fs.readFile(apiRulePath, 'utf8').catch(() => '');
    if (!forceReplace && existing.trim()) {
      // Rule already exists and we're not forcing replacement, skip
      return;
    }

    // Create directory if it doesn't exist
    const dir = path.dirname(apiRulePath);
    await fs.mkdir(dir, { recursive: true });

    // Write the rule file with the API documentation content
    await fs.writeFile(apiRulePath, apiDocContent, 'utf8');
  } catch (error: any) {
    // Silently fail - this is not critical
    console.error(`Failed to create qveris_ai_api rule: ${error?.message || error}`);
  }
}

