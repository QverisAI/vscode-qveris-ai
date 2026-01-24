import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';
import axios from 'axios';
import { ViewStateManager } from './stateManager';
import { HomeViewProvider } from './homeViewProvider';
import { copyCursorPrompt, openCursorPromptDoc, maybeEnsureCursorPromptInRules, maybeEnsureTraePromptInRules, maybeEnsureKiroPromptInRules, maybeEnsureCodebuddyPromptInRules, maybeEnsureLingmaPromptInRules, maybeEnsureQoderPromptInRules, ensureMcpConfigWithStoredKey, secretKeyName, globalStateKey, generateOAuthState, ensureMcpConfigWithApiKey, generateSessionId, getIdeScheme, isCursorApp, isTraeApp, isKiroApp, isCodebuddyApp, isLingmaApp, isQoderApp } from './utils';
import { initializeLogger, log, isTestMode } from './logger';
import { EXAMPLE_PROMPT } from './constants';

let stateManager: ViewStateManager;
let outputChannel: vscode.OutputChannel;

/**
 * Check if Node.js is available in the system
 * @returns Promise<boolean> - true if Node.js is available, false otherwise
 */
async function checkNodeEnvironment(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // Try to execute 'node --version' command
      cp.exec('node --version', { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          log('QVeris: Node.js check failed: ' + (error.message || error));
          resolve(false);
          return;
        }
        if (stdout) {
          log('QVeris: Node.js version detected: ' + stdout.trim());
          resolve(true);
        } else {
          log('QVeris: Node.js check returned no output');
          resolve(false);
        }
      });
    } catch (err: any) {
      log('QVeris: Node.js check exception: ' + (err?.message || err));
      resolve(false);
    }
  });
}

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
  // Initialize logger
  initializeLogger(context);
  
  // Create output channel for backward compatibility (used by showLogs command)
  outputChannel = vscode.window.createOutputChannel('QVeris AI');
  log('QVeris: Extension activating...');

  // Check Node.js environment
  const hasNode = await checkNodeEnvironment();
  if (!hasNode) {
    log('QVeris: Node.js environment not detected');
    const action = await vscode.window.showWarningMessage(
      'QVeris AI: Node.js environment not detected. Some features may require Node.js to work properly. Please install Node.js.',
      'Open Node.js Website',
      'Remind Me Later'
    );
    if (action === 'Open Node.js Website') {
      vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
    }
  }

  // Generate and store session_id if not exists (generated once per activation)
  let sessionId = context.globalState.get<string>(globalStateKey('sessionId'));
  if (!sessionId) {
    sessionId = generateSessionId();
    await context.globalState.update(globalStateKey('sessionId'), sessionId);
    log('QVeris: Generated new session_id: ' + sessionId);
  } else {
    log('QVeris: Using existing session_id: ' + sessionId);
  }

  stateManager = new ViewStateManager(context);

  const homeProvider = new HomeViewProvider(context, stateManager);

  log('QVeris: Registering URI Handler for OAuth callback');

  // Register URI Handler for OAuth callback
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
      log('QVeris: ===== URI HANDLER TRIGGERED =====');
      log('QVeris: Full URI: ' + uri.toString());
      log('QVeris: Scheme: ' + uri.scheme);
      log('QVeris: Authority: ' + uri.authority);
      log('QVeris: Path: ' + uri.path);
      log('QVeris: Query: ' + uri.query);
      log('QVeris: Fragment: ' + uri.fragment);

      // Check for OAuth callback - scheme should be vscode, cursor, trae, kiro, codebuddy, lingma, or qoder, authority should match our extension ID
      const isOAuthCallback = uri.path === '/auth-callback' &&
                             uri.authority === 'QverisAI.qveris-ai' &&
                             (uri.scheme === 'vscode' || uri.scheme === 'cursor' || uri.scheme === 'trae' || uri.scheme === 'kiro' || uri.scheme === 'codebuddy' || uri.scheme === 'lingma' || uri.scheme === 'qoder');

      log('QVeris: Is OAuth callback? ' + isOAuthCallback);

      if (isOAuthCallback) {
        log('QVeris: Handling OAuth callback - calling handleOAuthCallback');
        handleOAuthCallback(context, uri).catch(error => {
          log('QVeris: Error in handleOAuthCallback: ' + (error?.message || error));
          if (error?.stack) {
            log('QVeris: Error stack: ' + error.stack);
          }
        });
      } else {
        log('QVeris: URI does not match expected pattern.');
        log('QVeris: Expected: scheme=vscode/cursor/trae/kiro/codebuddy/lingma/qoder, authority=QverisAI.qveris-ai, path=/auth-callback');
        log('QVeris: Actual: scheme=' + uri.scheme + ', authority=' + uri.authority + ', path=' + uri.path);

        // Also log if it's close but not exact match
        const isCloseMatch = uri.path === '/auth-callback' && uri.authority === 'QverisAI.qveris-ai';
        if (isCloseMatch) {
          log('QVeris: URI is close match but scheme is wrong. Expected vscode/cursor/trae/kiro/codebuddy/lingma/qoder, got: ' + uri.scheme);
        }
      }

      log('QVeris: ===== URI HANDLER END =====');
    }
  });

  log('QVeris: URI Handler registered');

  console.log('QVeris: URI Handler registered successfully');

  context.subscriptions.push(
    uriHandler,
    vscode.window.registerWebviewViewProvider('qverisAi.home', homeProvider),
    vscode.commands.registerCommand('vscode-qveris-ai.openWebsite', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://qveris.ai/'));
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.oauthLogin', async () => {
      await initiateOAuthLogin(context);
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.showLogs', () => {
      if (outputChannel) {
        outputChannel.show();
      }
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.copyApiKey', async () => {
      const key = await context.secrets.get(secretKeyName('qverisApiKey'));
      if (!key) {
        vscode.window.showWarningMessage('No Qveris API key stored yet. Please sign in first.');
        return;
      }
      await vscode.env.clipboard.writeText(key);
      vscode.window.showInformationMessage('QVeris API key copied to clipboard.');
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.copyCursorPrompt', async () => {
      await copyCursorPrompt(context, false);
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.openCursorPromptDoc', async () => {
      await openCursorPromptDoc();
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.refreshSession', async () => {
      await stateManager.notifyLoginStateChanged();
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.tryExample', async () => {
      try {
        // Try to open chat with the example prompt pre-filled
        log('QVeris: Attempting to open chat with example prompt...');
        
        // Method 1: Try using workbench.action.chat.open with query parameter
        try {
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: EXAMPLE_PROMPT
          });
          log('QVeris: Successfully opened chat with example prompt (method 1)');
          vscode.window.showInformationMessage('Example prompt loaded in Chat! Press Enter to send.');
          return;
        } catch (err1) {
          log('QVeris: Method 1 failed: ' + (err1 instanceof Error ? err1.message : err1));
        }

        // Method 2: Try using the newer API with input
        try {
          await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
          await vscode.commands.executeCommand('editor.action.insertSnippet', {
            snippet: EXAMPLE_PROMPT
          });
          log('QVeris: Successfully opened chat with example prompt (method 2)');
          vscode.window.showInformationMessage('Example prompt loaded in Chat! Press Enter to send.');
          return;
        } catch (err2) {
          log('QVeris: Method 2 failed: ' + (err2 instanceof Error ? err2.message : err2));
        }

        // Fallback: Copy to clipboard and open chat
        log('QVeris: Using fallback method - copy to clipboard');
        await vscode.env.clipboard.writeText(EXAMPLE_PROMPT);
        
        const action = await vscode.window.showInformationMessage(
          'Example prompt copied to clipboard! Open Chat and paste it to get started.',
          'Open Chat'
        );
        
        if (action === 'Open Chat') {
          try {
            await vscode.commands.executeCommand('workbench.action.chat.open');
          } catch (err3) {
            log('QVeris: Could not open chat panel: ' + (err3 instanceof Error ? err3.message : err3));
          }
        }
      } catch (error) {
        log('QVeris: Error in tryExample command: ' + (error instanceof Error ? error.message : error));
        vscode.window.showErrorMessage('Failed to open chat with example prompt. Please try manually.');
      }
    })
  );

  // Check if this is a new installation or update by comparing extension version
  const currentVersion = await getExtensionVersion(context);
  const storedVersion = context.globalState.get<string>(globalStateKey('extensionVersion'));
  const isNewInstallOrUpdate = !storedVersion || storedVersion !== currentVersion;
  
  // Log version information
  log(`QVeris: Current version: ${currentVersion}`);
  log(`QVeris: Stored version: ${storedVersion || 'none'}`);
  log(`QVeris: Is new install or update: ${isNewInstallOrUpdate}`);
  
  // Update stored version
  if (currentVersion) {
    await context.globalState.update(globalStateKey('extensionVersion'), currentVersion);
    log(`QVeris: Updated stored version to: ${currentVersion}`);
  }

  // Execute installation tasks immediately on activation
  // Force replace rule files if this is a new installation or update
  log(`QVeris: Ensuring MCP config and rule files (forceReplace=${isNewInstallOrUpdate})...`);
  await ensureMcpConfigWithStoredKey(context);
  await maybeEnsureCursorPromptInRules(context, isNewInstallOrUpdate);
  await maybeEnsureTraePromptInRules(context, isNewInstallOrUpdate);
  await maybeEnsureKiroPromptInRules(context, isNewInstallOrUpdate);
  await maybeEnsureCodebuddyPromptInRules(context, isNewInstallOrUpdate);
  await maybeEnsureLingmaPromptInRules(context, isNewInstallOrUpdate);
  await maybeEnsureQoderPromptInRules(context, isNewInstallOrUpdate);

  // Show welcome message for new installations or updates
  if (isNewInstallOrUpdate) {
    const isFirstInstall = !storedVersion;
    const message = isFirstInstall 
      ? `Welcome to QVeris AI! 🎉 Sign in to get started and unlock AI-powered tools.`
      : `QVeris AI has been updated to v${currentVersion}! Check out what's new.`;
    
    const action = await vscode.window.showInformationMessage(
      message,
      'Try Example',
      'Open Sidebar',
      'Learn More'
    );
    
    if (action === 'Try Example') {
      // Execute the tryExample command
      vscode.commands.executeCommand('vscode-qveris-ai.tryExample');
    } else if (action === 'Open Sidebar') {
      // Focus on QVeris AI sidebar
      vscode.commands.executeCommand('workbench.view.extension.qverisAi');
    } else if (action === 'Learn More') {
      vscode.env.openExternal(vscode.Uri.parse('https://qveris.ai'));
    }
  }

  // Also listen for workspace folder changes to ensure rules are installed when workspace becomes available
  const ensureRulesOnWorkspaceChange = async (silent: boolean = false) => {
    await maybeEnsureCursorPromptInRules(context, false, silent);
    await maybeEnsureTraePromptInRules(context, false, silent);
    await maybeEnsureKiroPromptInRules(context, false, silent);
    await maybeEnsureCodebuddyPromptInRules(context, false, silent);
    await maybeEnsureLingmaPromptInRules(context, false, silent);
    await maybeEnsureQoderPromptInRules(context, false, silent);
  };

  // Check rules file on workspace folder changes (including when folders are opened)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      // Check rules for newly added folders
      if (event.added.length > 0) {
        log('QVeris: Workspace folders added, checking for rule files...');
        await ensureRulesOnWorkspaceChange(false); // Show message when folder is opened
      }
      // Also check when folders are removed (in case the last folder was removed and a new one added)
      if (event.removed.length > 0 && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        log('QVeris: Workspace folders changed, checking for rule files...');
        await ensureRulesOnWorkspaceChange(false);
      }
    })
  );

  // Set up periodic check for rule files (only in Cursor, Trae, Kiro, Codebuddy, Lingma, or Qoder)
  const isCursor = isCursorApp();
  const isTrae = isTraeApp();
  const isKiro = isKiroApp();
  const isCodebuddy = isCodebuddyApp();
  const isLingma = isLingmaApp();
  const isQoder = isQoderApp();
  if (isCursor || isTrae || isKiro || isCodebuddy || isLingma || isQoder) {
    const ideName = isQoder ? 'Qoder' : (isLingma ? 'Lingma' : (isCodebuddy ? 'Codebuddy' : (isKiro ? 'Kiro' : (isTrae ? 'Trae' : 'Cursor'))));
    log(`QVeris: Setting up periodic check for rule files in ${ideName}...`);
    
    // Check immediately if workspace is already available (silent to avoid duplicate messages)
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      await ensureRulesOnWorkspaceChange(true); // Silent for initial check
    }

    // Set up periodic check every hour (silent mode to avoid spam)
    const checkInterval = 60 * 60 * 1000; // 1 hour
    const periodicCheck = setInterval(async () => {
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        await ensureRulesOnWorkspaceChange(true); // Silent for periodic checks
      }
    }, checkInterval);

    // Clean up interval on deactivation
    context.subscriptions.push({
      dispose: () => {
        clearInterval(periodicCheck);
      }
    });
  }
}

// Get backend URL from config, or use default
function getBackendUrl(config?: vscode.WorkspaceConfiguration): string {  
  // Get config if not provided
  if (!config) {
    config = vscode.workspace.getConfiguration('qverisAi');
  }
  
  // First try to get from config
  const configUrl = config.get<string>('backendUrl');
  
  if (configUrl) {
    // Remove trailing slashes for consistency
    return configUrl.replace(/\/+$/, '');
  }

  // If no config, use default
  return 'https://qveris.ai';
}

// Get login URL by assembling from backend URL
function getLoginUrl(config?: vscode.WorkspaceConfiguration): string {
  const backendUrl = getBackendUrl(config);
  return `${backendUrl}/login`;
}

async function initiateOAuthLogin(context: vscode.ExtensionContext) {
  // Use configured backend URL for login page
  const config = vscode.workspace.getConfiguration('qverisAi');
  const backendUrl = getBackendUrl(config);
  const loginUrl = `${backendUrl}/login`;
  const state = generateOAuthState();

  // Store the state for CSRF protection
  await context.globalState.update(globalStateKey('oauthState'), state);

  // Use vscode/cursor/trae/kiro/codebuddy/lingma/qoder protocol handler URL
  const scheme = getIdeScheme();
  const callbackUrl = `${scheme}://QverisAI.qveris-ai/auth-callback`;

  log('QVeris: backendUrl: ' + backendUrl);
  log('QVeris: Generated OAuth state: ' + state);
  log('QVeris: Expected callback URL: ' + callbackUrl);

  const fullUrl = `${loginUrl}?f=${encodeURIComponent(state)}&callback_url=${encodeURIComponent(callbackUrl)}`;
  log('Qveris: Opening login URL: ' + fullUrl);

  await vscode.env.openExternal(vscode.Uri.parse(fullUrl));
}

async function handleOAuthCallback(context: vscode.ExtensionContext, uri: vscode.Uri) {
  log('QVeris: ===== OAUTH CALLBACK START =====');
  log('QVeris: Processing OAuth callback with URI: ' + uri.toString());
  log('QVeris: URI query string: ' + uri.query);

  const queryParams = new URLSearchParams(uri.query);
  const f = queryParams.get('f');
  let accessToken = queryParams.get('access_token');

  log('QVeris: f parameter: ' + (f || 'null'));
  log('QVeris: access_token present: ' + !!accessToken);
  if (accessToken) {
    log('QVeris: access_token length: ' + accessToken.length);
    log('QVeris: access_token first 20 chars: ' + accessToken.substring(0, 20));
    log('QVeris: access_token last 20 chars: ' + accessToken.substring(Math.max(0, accessToken.length - 20)));
  }

  // Decode URL-encoded token if needed
  if (accessToken) {
    try {
      // URLSearchParams should already decode, but let's make sure
      const decoded = decodeURIComponent(accessToken);
      if (decoded !== accessToken) {
        log('QVeris: Token was URL-encoded, decoded it');
        accessToken = decoded;
      }
    } catch (e: any) {
      log('QVeris: Token decode attempt (may already be decoded): ' + (e?.message || e));
    }
  }

  if (!f || !accessToken) {
    log('QVeris: Missing required parameters');
    vscode.window.showErrorMessage('OAuth callback missing required parameters');
    return;
  }

  // Verify CSRF state
  const storedState = context.globalState.get<string>(globalStateKey('oauthState'));
  log('QVeris: stored state: ' + (storedState || 'null'));
  log('QVeris: received f: ' + f);

  if (!storedState || storedState !== f) {
    log('QVeris: State verification failed');
    vscode.window.showErrorMessage('OAuth state verification failed');
    return;
  }

  // Clear the stored state
  await context.globalState.update(globalStateKey('oauthState'), undefined);
  log('QVeris: State cleared, processing token');

  try {
    log('QVeris: Calling processOAuthToken...');
    // Process the OAuth token similar to regular login
    await processOAuthToken(context, accessToken);
    log('QVeris: OAuth login succeeded');
    vscode.window.showInformationMessage('QVeris OAuth login succeeded!');
  } catch (error: any) {
    log('QVeris: OAuth login failed: ' + (error?.message || error));
    if (error?.stack) {
      log('QVeris: Error stack: ' + error.stack);
    }
    vscode.window.showErrorMessage(`OAuth login failed: ${error.message || error}`);
  }
  log('QVeris: ===== OAUTH CALLBACK END =====');
}

async function processOAuthToken(context: vscode.ExtensionContext, accessToken: string) {
  const config = vscode.workspace.getConfiguration('qverisAi');
  const baseUrl = getBackendUrl(config).replace(/\/+$/, '');

  let userEmail: string | undefined;

  // First, try to decode email from JWT token as primary method
  log('QVeris: Attempting to decode email from JWT token...');
  log('QVeris: Access token length: ' + accessToken.length);
  log('QVeris: Access token first 50 chars: ' + accessToken.substring(0, 50));
  
  try {
    const jwtPayload = decodeJwtPayload(accessToken);
    log('QVeris: JWT payload decoded: ' + (jwtPayload ? 'success' : 'failed'));
    
    if (jwtPayload) {
      log('QVeris: JWT payload keys: ' + Object.keys(jwtPayload).join(', '));
      log('QVeris: JWT payload content: ' + JSON.stringify(jwtPayload, null, 2));
      
      if (jwtPayload?.email) {
        userEmail = jwtPayload.email;
        log('QVeris: ✅ Found email in JWT token: ' + userEmail);
      } else {
        log('QVeris: ❌ JWT payload does not contain email field');
      }
    } else {
      log('QVeris: ❌ JWT decode returned null');
    }
  } catch (jwtError: any) {
    log('QVeris: ❌ JWT decode exception: ' + (jwtError?.message || jwtError));
    if (jwtError?.stack) {
      log('QVeris: JWT decode error stack: ' + jwtError.stack);
    }
  }

  // If JWT doesn't contain email, try API call
  if (!userEmail) {
    log('QVeris: JWT token does not contain email, trying API call...');
    log('QVeris: Fetching user info with baseUrl: ' + baseUrl);
    const userInfo = await axios.get(`${baseUrl}/rpc/v1/auth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000
    });

    log('QVeris: User info response: ' + JSON.stringify(userInfo.data, null, 2));
    log('QVeris: Full response structure: ' + JSON.stringify({
      status: userInfo.status,
      statusText: userInfo.statusText,
      data: userInfo.data
    }, null, 2));

    // Try multiple possible email field paths from API response
    userEmail = userInfo.data?.data?.email ||
                userInfo.data?.email ||
                userInfo.data?.user?.email ||
                userInfo.data?.result?.email ||
                userInfo.data?.data?.user?.email;

    if (!userEmail) {
      log('QVeris: No email found in API response. Tried paths:');
      log('  - data.data.email: ' + (userInfo.data?.data?.email || 'undefined'));
      log('  - data.email: ' + (userInfo.data?.email || 'undefined'));
      log('  - data.user.email: ' + (userInfo.data?.user?.email || 'undefined'));
      log('  - data.result.email: ' + (userInfo.data?.result?.email || 'undefined'));
      log('  - data.data.user.email: ' + (userInfo.data?.data?.user?.email || 'undefined'));
      log('QVeris: Available top-level fields: ' + Object.keys(userInfo.data || {}).join(', '));
      if (userInfo.data?.data) {
        log('QVeris: Available data.data fields: ' + Object.keys(userInfo.data.data).join(', '));
      }

      // Try to find any field that looks like an email
      const findEmailInObject = (obj: any): string | null => {
        if (!obj || typeof obj !== 'object') return null;

        for (const [key, value] of Object.entries(obj)) {
          if (key.toLowerCase().includes('email') && typeof value === 'string' && value.includes('@')) {
            return value;
          }
          if (typeof value === 'object') {
            const nestedEmail = findEmailInObject(value);
            if (nestedEmail) return nestedEmail;
          }
        }
        return null;
      };

      const foundEmail = findEmailInObject(userInfo.data);
      if (foundEmail) {
        userEmail = foundEmail;
      }
    }
  }

  if (!userEmail) {
    // Last resort: ask user to provide email manually
    log('QVeris: Could not find email from JWT or API. Asking user...');
    const manualEmail = await vscode.window.showInputBox({
      prompt: 'Could not automatically detect email from JWT token or API response. Please enter your email address:',
      placeHolder: 'your-email@example.com'
    });

    if (!manualEmail) {
      throw new Error('Email is required but could not be detected from JWT token or API response.');
    }

    userEmail = manualEmail;
    log('QVeris: User provided email manually: ' + userEmail);
  }

  log('QVeris: Final user email: ' + userEmail);


  // Obtain API key using the access token
  log('QVeris: Starting API key retrieval process...');
  log('QVeris: Using baseUrl: ' + baseUrl);
  log('QVeris: Access token for API calls: ' + accessToken.substring(0, 20) + '...');
  
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try existing keys first
  let apiKey: string | undefined;
  try {
    const listApiKeysUrl = `${baseUrl}/rpc/v1/auth/api-keys/list`;
    log('QVeris: Attempting to list existing API keys...');
    log('QVeris: List API keys endpoint URL: ' + listApiKeysUrl);
    log('QVeris: Request method: GET');
    log('QVeris: Request headers: ' + JSON.stringify({
      Authorization: headers.Authorization ? `Bearer ${accessToken.substring(0, 20)}...` : 'missing',
      'Content-Type': 'application/json'
    }, null, 2));
    log('QVeris: Authorization header format: Bearer <token>');
    log('QVeris: Authorization token length: ' + accessToken.length);
    log('QVeris: Authorization token preview: ' + accessToken.substring(0, 50) + '...');
    log('QVeris: Request timeout: 15000ms');
    const listResp = await axios.get(listApiKeysUrl, { headers, timeout: 15000 });
    log('QVeris: List API keys response status: ' + listResp.status);
    log('QVeris: List API keys response status text: ' + listResp.statusText);
    log('QVeris: List API keys response headers: ' + JSON.stringify(listResp.headers, null, 2));
    log('QVeris: List API keys response data: ' + JSON.stringify(listResp.data, null, 2));
    
    if (listResp.data?.status === 'success' && Array.isArray(listResp.data?.data?.api_keys)) {
      const keys = listResp.data.data.api_keys;
      log('QVeris: Found ' + keys.length + ' existing API keys');
      if (keys.length > 0) {
        const firstKey = keys[0];
        log('QVeris: First API key data structure: ' + JSON.stringify(firstKey, null, 2));
        log('QVeris: First API key name: ' + (firstKey.name || 'undefined'));
        log('QVeris: First API key id: ' + (firstKey.id || 'undefined'));
        log('QVeris: Attempting to get full key for: ' + firstKey.name);
        try {
          // Try using name first (current approach)
          let getFullKeyUrl = `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.name)}`;
          
          // If ID exists, also log what the URL would be with ID
          if (firstKey.id) {
            log('QVeris: API key has ID, alternative URL with ID would be: ' + `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.id)}`);
          }
          
          log('QVeris: Get full key endpoint URL: ' + getFullKeyUrl);
          log('QVeris: Request method: GET');
          log('QVeris: Request headers: ' + JSON.stringify({
            Authorization: headers.Authorization ? `Bearer ${accessToken.substring(0, 20)}...` : 'missing',
            'Content-Type': 'application/json'
          }, null, 2));
          const fullKeyResp = await axios.get(getFullKeyUrl, { headers, timeout: 15000 });
          log('QVeris: Get full key response status: ' + fullKeyResp.status);
          log('QVeris: Get full key response status text: ' + fullKeyResp.statusText);
          log('QVeris: Get full key response data: ' + JSON.stringify(fullKeyResp.data, null, 2));
          
          if (fullKeyResp.data?.status === 'success' && fullKeyResp.data?.data?.api_key) {
            apiKey = fullKeyResp.data.data.api_key;
            log('QVeris: ✅ Successfully retrieved existing API key');
          } else {
            log('QVeris: ❌ Get full key response does not contain API key');
          }
        } catch (getKeyError: any) {
          log('QVeris: ❌ Error getting full key with name: ' + (getKeyError?.message || getKeyError));
          if (getKeyError?.response) {
            log('QVeris: Error response status: ' + getKeyError.response.status);
            log('QVeris: Error response data: ' + JSON.stringify(getKeyError.response.data, null, 2));
          }
          
          // If failed with name and we have an ID, try with ID
          if (firstKey.id && getKeyError?.response?.status === 404) {
            log('QVeris: Trying to get full key using ID instead of name...');
            try {
              const getFullKeyUrlById = `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.id)}`;
              log('QVeris: Get full key endpoint URL (using ID): ' + getFullKeyUrlById);
              const fullKeyRespById = await axios.get(getFullKeyUrlById, { headers, timeout: 15000 });
              log('QVeris: Get full key response status (using ID): ' + fullKeyRespById.status);
              log('QVeris: Get full key response data (using ID): ' + JSON.stringify(fullKeyRespById.data, null, 2));
              
              if (fullKeyRespById.data?.status === 'success' && fullKeyRespById.data?.data?.api_key) {
                apiKey = fullKeyRespById.data.data.api_key;
                log('QVeris: ✅ Successfully retrieved existing API key using ID');
              } else {
                log('QVeris: ❌ Get full key response (using ID) does not contain API key');
              }
            } catch (getKeyErrorById: any) {
              log('QVeris: ❌ Error getting full key with ID: ' + (getKeyErrorById?.message || getKeyErrorById));
              if (getKeyErrorById?.response) {
                log('QVeris: Error response status (using ID): ' + getKeyErrorById.response.status);
                log('QVeris: Error response data (using ID): ' + JSON.stringify(getKeyErrorById.response.data, null, 2));
              }
              // ignore and continue
            }
          } else {
            // ignore and continue
          }
        }
      }
    } else {
      log('QVeris: List API keys response does not contain valid keys array');
    }
  } catch (listError: any) {
    log('QVeris: ❌ Error listing API keys: ' + (listError?.message || listError));
    log('QVeris: Error type: ' + (listError?.constructor?.name || 'unknown'));
    if (listError?.stack) {
      log('QVeris: Error stack: ' + listError.stack);
    }
    
    // Log request details
    if (listError?.config) {
      log('QVeris: Failed request URL: ' + (listError.config.url || 'unknown'));
      log('QVeris: Failed request method: ' + (listError.config.method || 'unknown'));
      log('QVeris: Failed request baseURL: ' + (listError.config.baseURL || 'unknown'));
      log('QVeris: Failed request headers: ' + JSON.stringify({
        ...listError.config.headers,
        Authorization: listError.config.headers?.Authorization ? 
          `Bearer ${listError.config.headers.Authorization.replace('Bearer ', '').substring(0, 20)}...` : 
          'missing'
      }, null, 2));
      log('QVeris: Failed request timeout: ' + (listError.config.timeout || 'unknown'));
    }
    
    if (listError?.request) {
      log('QVeris: Request was sent but no response received');
      log('QVeris: Request path: ' + (listError.request.path || 'unknown'));
      log('QVeris: Request host: ' + (listError.request.host || 'unknown'));
    }
    
    if (listError?.response) {
      log('QVeris: Error response status: ' + listError.response.status);
      log('QVeris: Error response status text: ' + listError.response.statusText);
      log('QVeris: Error response data: ' + JSON.stringify(listError.response.data, null, 2));
      log('QVeris: Error response headers: ' + JSON.stringify(listError.response.headers, null, 2));
    }
    
    // ignore and continue
  }

  // If no API key found, throw an error instead of creating a new one
  if (!apiKey) {
    log('QVeris: ❌ No existing API key found. Please create an API key in your QVeris account first.');
    throw new Error('No API key found. Please create an API key in your QVeris account and try again.');
  }

  // Store the credentials
  await context.secrets.store(secretKeyName('qverisApiKey'), apiKey);
  await context.secrets.store(secretKeyName('qverisAccessToken'), accessToken);
  await context.secrets.store(secretKeyName('qverisEmail'), userEmail);
  await context.globalState.update(globalStateKey('qverisEmail'), userEmail);

  // Configure MCP
  await ensureMcpConfigWithApiKey(apiKey);

  // Notify state change
  if (stateManager) {
    await stateManager.notifyLoginStateChanged();
  }
}

// Decode JWT payload without signature verification
function decodeJwtPayload(token: string): any {
  try {
    log('QVeris: decodeJwtPayload - token length: ' + token.length);
    
    const parts = token.split('.');
    log('QVeris: decodeJwtPayload - parts count: ' + parts.length);
    
    if (parts.length !== 3) {
      log('QVeris: Invalid JWT format - expected 3 parts, got ' + parts.length);
      throw new Error(`Invalid JWT token format: expected 3 parts, got ${parts.length}`);
    }

    log('QVeris: decodeJwtPayload - payload part length: ' + parts[1].length);
    
    // Base64 decode the payload
    const decoded = Buffer.from(parts[1], 'base64').toString();
    log('QVeris: decodeJwtPayload - decoded payload length: ' + decoded.length);
    log('QVeris: decodeJwtPayload - decoded payload preview: ' + decoded.substring(0, 100));
    
    const payload = JSON.parse(decoded);
    log('QVeris: decodeJwtPayload - JSON parse successful');
    
    return payload;
  } catch (error: any) {
    log('QVeris: JWT decode error: ' + (error?.message || error));
    log('QVeris: JWT decode error type: ' + (error?.constructor?.name || 'unknown'));
    if (error?.stack) {
      log('QVeris: JWT decode error stack: ' + error.stack);
    }
    return null;
  }
}

export function deactivate() {
  // Nothing to cleanup
}
