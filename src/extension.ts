import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { ViewStateManager } from './stateManager';
import { HomeViewProvider } from './homeViewProvider';
import { ToolSearchViewProvider } from './toolSearchViewProvider';
import { FeaturedToolsViewProvider } from './featuredToolsViewProvider';
import { ToolSpecificationViewProvider } from './toolSpecificationViewProvider';
import { copyCursorPrompt, openCursorPromptDoc, maybeEnsureCursorPromptInRules, ensureMcpConfigWithStoredKey, secretKeyName, globalStateKey, generateOAuthState, ensureMcpConfigWithApiKey, generateSessionId } from './utils';
import { initializeLogger, log, isTestMode } from './logger';

let stateManager: ViewStateManager;
let outputChannel: vscode.OutputChannel;

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
  outputChannel = vscode.window.createOutputChannel('Qveris AI');
  log('Qveris: Extension activating...');

  // Generate and store session_id if not exists (generated once per activation)
  let sessionId = context.globalState.get<string>(globalStateKey('sessionId'));
  if (!sessionId) {
    sessionId = generateSessionId();
    await context.globalState.update(globalStateKey('sessionId'), sessionId);
    log('Qveris: Generated new session_id: ' + sessionId);
  } else {
    log('Qveris: Using existing session_id: ' + sessionId);
  }

  stateManager = new ViewStateManager(context);

  const homeProvider = new HomeViewProvider(context, stateManager);
  const toolSearchProvider = new ToolSearchViewProvider(context, stateManager);
  const featuredToolsProvider = new FeaturedToolsViewProvider(context, stateManager);
  const toolSpecificationProvider = new ToolSpecificationViewProvider(context, stateManager);

  log('Qveris: Registering URI Handler for OAuth callback');

  // Register URI Handler for OAuth callback
  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
      log('Qveris: ===== URI HANDLER TRIGGERED =====');
      log('Qveris: Full URI: ' + uri.toString());
      log('Qveris: Scheme: ' + uri.scheme);
      log('Qveris: Authority: ' + uri.authority);
      log('Qveris: Path: ' + uri.path);
      log('Qveris: Query: ' + uri.query);
      log('Qveris: Fragment: ' + uri.fragment);

      // Check for OAuth callback - scheme should be vscode or cursor, authority should match our extension ID
      const isOAuthCallback = uri.path === '/auth-callback' &&
                             uri.authority === 'QverisAI.qveris-ai' &&
                             (uri.scheme === 'vscode' || uri.scheme === 'cursor');

      log('Qveris: Is OAuth callback? ' + isOAuthCallback);

      if (isOAuthCallback) {
        log('Qveris: Handling OAuth callback - calling handleOAuthCallback');
        handleOAuthCallback(context, uri).catch(error => {
          log('Qveris: Error in handleOAuthCallback: ' + (error?.message || error));
          if (error?.stack) {
            log('Qveris: Error stack: ' + error.stack);
          }
        });
      } else {
        log('Qveris: URI does not match expected pattern.');
        log('Qveris: Expected: scheme=vscode/cursor, authority=QverisAI.qveris-ai, path=/auth-callback');
        log('Qveris: Actual: scheme=' + uri.scheme + ', authority=' + uri.authority + ', path=' + uri.path);

        // Also log if it's close but not exact match
        const isCloseMatch = uri.path === '/auth-callback' && uri.authority === 'QverisAI.qveris-ai';
        if (isCloseMatch) {
          log('Qveris: URI is close match but scheme is wrong. Expected vscode/cursor, got: ' + uri.scheme);
        }
      }

      log('Qveris: ===== URI HANDLER END =====');
    }
  });

  log('Qveris: URI Handler registered');

  console.log('Qveris: URI Handler registered successfully');

  context.subscriptions.push(
    uriHandler,
    vscode.window.registerWebviewViewProvider('qverisAi.home', homeProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.toolSearch', toolSearchProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.featuredTools', featuredToolsProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.toolSpecification', toolSpecificationProvider),
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

// Get backend URL from config, or use default based on test mode
function getBackendUrl(config?: vscode.WorkspaceConfiguration): string {  
  if (isTestMode()) {
    return 'http://localhost:3000';
  }
  // Get config if not provided
  if (!config) {
    config = vscode.workspace.getConfiguration('qverisAi');
  }
  
  // First try to get from config
  const configUrl = config.get<string>('backendUrl');
  if (configUrl) {
    return configUrl;
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
  const config = vscode.workspace.getConfiguration('qverisAi');
  const backendUrl = getBackendUrl(config).replace(/\/+$/, '');
  const loginUrl = `${backendUrl}/login`;
  const state = generateOAuthState();

  // Store the state for CSRF protection
  await context.globalState.update(globalStateKey('oauthState'), state);

  // Use vscode/cursor protocol handler URL
  const isCursor = require('./utils').isCursorApp();
  const scheme = isCursor ? 'cursor' : 'vscode';
  const callbackUrl = `${scheme}://QverisAI.qveris-ai/auth-callback`;

  log('Qveris: Generated OAuth state: ' + state);
  log('Qveris: Expected callback URL: ' + callbackUrl);

  const fullUrl = `${loginUrl}?f=${encodeURIComponent(state)}&callback_url=${encodeURIComponent(callbackUrl)}`;
  log('Qveris: Opening login URL: ' + fullUrl);

  await vscode.env.openExternal(vscode.Uri.parse(fullUrl));
}

async function handleOAuthCallback(context: vscode.ExtensionContext, uri: vscode.Uri) {
  log('Qveris: ===== OAUTH CALLBACK START =====');
  log('Qveris: Processing OAuth callback with URI: ' + uri.toString());
  log('Qveris: URI query string: ' + uri.query);

  const queryParams = new URLSearchParams(uri.query);
  const f = queryParams.get('f');
  let accessToken = queryParams.get('access_token');

  log('Qveris: f parameter: ' + (f || 'null'));
  log('Qveris: access_token present: ' + !!accessToken);
  if (accessToken) {
    log('Qveris: access_token length: ' + accessToken.length);
    log('Qveris: access_token first 20 chars: ' + accessToken.substring(0, 20));
    log('Qveris: access_token last 20 chars: ' + accessToken.substring(Math.max(0, accessToken.length - 20)));
  }

  // Decode URL-encoded token if needed
  if (accessToken) {
    try {
      // URLSearchParams should already decode, but let's make sure
      const decoded = decodeURIComponent(accessToken);
      if (decoded !== accessToken) {
        log('Qveris: Token was URL-encoded, decoded it');
        accessToken = decoded;
      }
    } catch (e: any) {
      log('Qveris: Token decode attempt (may already be decoded): ' + (e?.message || e));
    }
  }

  if (!f || !accessToken) {
    log('Qveris: Missing required parameters');
    vscode.window.showErrorMessage('OAuth callback missing required parameters');
    return;
  }

  // Verify CSRF state
  const storedState = context.globalState.get<string>(globalStateKey('oauthState'));
  log('Qveris: stored state: ' + (storedState || 'null'));
  log('Qveris: received f: ' + f);

  if (!storedState || storedState !== f) {
    log('Qveris: State verification failed');
    vscode.window.showErrorMessage('OAuth state verification failed');
    return;
  }

  // Clear the stored state
  await context.globalState.update(globalStateKey('oauthState'), undefined);
  log('Qveris: State cleared, processing token');

  try {
    log('Qveris: Calling processOAuthToken...');
    // Process the OAuth token similar to regular login
    await processOAuthToken(context, accessToken);
    log('Qveris: OAuth login succeeded');
    vscode.window.showInformationMessage('Qveris OAuth login succeeded!');
  } catch (error: any) {
    log('Qveris: OAuth login failed: ' + (error?.message || error));
    if (error?.stack) {
      log('Qveris: Error stack: ' + error.stack);
    }
    vscode.window.showErrorMessage(`OAuth login failed: ${error.message || error}`);
  }
  log('Qveris: ===== OAUTH CALLBACK END =====');
}

async function processOAuthToken(context: vscode.ExtensionContext, accessToken: string) {
  const config = vscode.workspace.getConfiguration('qverisAi');
  const baseUrl = getBackendUrl(config).replace(/\/+$/, '');

  let userEmail: string | undefined;

  // First, try to decode email from JWT token as primary method
  log('Qveris: Attempting to decode email from JWT token...');
  log('Qveris: Access token length: ' + accessToken.length);
  log('Qveris: Access token first 50 chars: ' + accessToken.substring(0, 50));
  
  try {
    const jwtPayload = decodeJwtPayload(accessToken);
    log('Qveris: JWT payload decoded: ' + (jwtPayload ? 'success' : 'failed'));
    
    if (jwtPayload) {
      log('Qveris: JWT payload keys: ' + Object.keys(jwtPayload).join(', '));
      log('Qveris: JWT payload content: ' + JSON.stringify(jwtPayload, null, 2));
      
      if (jwtPayload?.email) {
        userEmail = jwtPayload.email;
        log('Qveris: ✅ Found email in JWT token: ' + userEmail);
      } else {
        log('Qveris: ❌ JWT payload does not contain email field');
      }
    } else {
      log('Qveris: ❌ JWT decode returned null');
    }
  } catch (jwtError: any) {
    log('Qveris: ❌ JWT decode exception: ' + (jwtError?.message || jwtError));
    if (jwtError?.stack) {
      log('Qveris: JWT decode error stack: ' + jwtError.stack);
    }
  }

  // If JWT doesn't contain email, try API call
  if (!userEmail) {
    log('Qveris: JWT token does not contain email, trying API call...');
    log('Qveris: Fetching user info with baseUrl: ' + baseUrl);
    const userInfo = await axios.get(`${baseUrl}/rpc/v1/auth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000
    });

    log('Qveris: User info response: ' + JSON.stringify(userInfo.data, null, 2));
    log('Qveris: Full response structure: ' + JSON.stringify({
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
      log('Qveris: No email found in API response. Tried paths:');
      log('  - data.data.email: ' + (userInfo.data?.data?.email || 'undefined'));
      log('  - data.email: ' + (userInfo.data?.email || 'undefined'));
      log('  - data.user.email: ' + (userInfo.data?.user?.email || 'undefined'));
      log('  - data.result.email: ' + (userInfo.data?.result?.email || 'undefined'));
      log('  - data.data.user.email: ' + (userInfo.data?.data?.user?.email || 'undefined'));
      log('Qveris: Available top-level fields: ' + Object.keys(userInfo.data || {}).join(', '));
      if (userInfo.data?.data) {
        log('Qveris: Available data.data fields: ' + Object.keys(userInfo.data.data).join(', '));
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
    log('Qveris: Could not find email from JWT or API. Asking user...');
    const manualEmail = await vscode.window.showInputBox({
      prompt: 'Could not automatically detect email from JWT token or API response. Please enter your email address:',
      placeHolder: 'your-email@example.com'
    });

    if (!manualEmail) {
      throw new Error('Email is required but could not be detected from JWT token or API response.');
    }

    userEmail = manualEmail;
    log('Qveris: User provided email manually: ' + userEmail);
  }

  log('Qveris: Final user email: ' + userEmail);


  // Obtain API key using the access token
  log('Qveris: Starting API key retrieval process...');
  log('Qveris: Using baseUrl: ' + baseUrl);
  log('Qveris: Access token for API calls: ' + accessToken.substring(0, 20) + '...');
  
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try existing keys first
  let apiKey: string | undefined;
  try {
    const listApiKeysUrl = `${baseUrl}/rpc/v1/auth/api-keys/list`;
    log('Qveris: Attempting to list existing API keys...');
    log('Qveris: List API keys endpoint URL: ' + listApiKeysUrl);
    log('Qveris: Request method: GET');
    log('Qveris: Request headers: ' + JSON.stringify({
      Authorization: headers.Authorization ? `Bearer ${accessToken.substring(0, 20)}...` : 'missing',
      'Content-Type': 'application/json'
    }, null, 2));
    log('Qveris: Authorization header format: Bearer <token>');
    log('Qveris: Authorization token length: ' + accessToken.length);
    log('Qveris: Authorization token preview: ' + accessToken.substring(0, 50) + '...');
    log('Qveris: Request timeout: 15000ms');
    const listResp = await axios.get(listApiKeysUrl, { headers, timeout: 15000 });
    log('Qveris: List API keys response status: ' + listResp.status);
    log('Qveris: List API keys response status text: ' + listResp.statusText);
    log('Qveris: List API keys response headers: ' + JSON.stringify(listResp.headers, null, 2));
    log('Qveris: List API keys response data: ' + JSON.stringify(listResp.data, null, 2));
    
    if (listResp.data?.status === 'success' && Array.isArray(listResp.data?.data?.api_keys)) {
      const keys = listResp.data.data.api_keys;
      log('Qveris: Found ' + keys.length + ' existing API keys');
      if (keys.length > 0) {
        const firstKey = keys[0];
        log('Qveris: First API key data structure: ' + JSON.stringify(firstKey, null, 2));
        log('Qveris: First API key name: ' + (firstKey.name || 'undefined'));
        log('Qveris: First API key id: ' + (firstKey.id || 'undefined'));
        log('Qveris: Attempting to get full key for: ' + firstKey.name);
        try {
          // Try using name first (current approach)
          let getFullKeyUrl = `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.name)}`;
          
          // If ID exists, also log what the URL would be with ID
          if (firstKey.id) {
            log('Qveris: API key has ID, alternative URL with ID would be: ' + `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.id)}`);
          }
          
          log('Qveris: Get full key endpoint URL: ' + getFullKeyUrl);
          log('Qveris: Request method: GET');
          log('Qveris: Request headers: ' + JSON.stringify({
            Authorization: headers.Authorization ? `Bearer ${accessToken.substring(0, 20)}...` : 'missing',
            'Content-Type': 'application/json'
          }, null, 2));
          const fullKeyResp = await axios.get(getFullKeyUrl, { headers, timeout: 15000 });
          log('Qveris: Get full key response status: ' + fullKeyResp.status);
          log('Qveris: Get full key response status text: ' + fullKeyResp.statusText);
          log('Qveris: Get full key response data: ' + JSON.stringify(fullKeyResp.data, null, 2));
          
          if (fullKeyResp.data?.status === 'success' && fullKeyResp.data?.data?.api_key) {
            apiKey = fullKeyResp.data.data.api_key;
            log('Qveris: ✅ Successfully retrieved existing API key');
          } else {
            log('Qveris: ❌ Get full key response does not contain API key');
          }
        } catch (getKeyError: any) {
          log('Qveris: ❌ Error getting full key with name: ' + (getKeyError?.message || getKeyError));
          if (getKeyError?.response) {
            log('Qveris: Error response status: ' + getKeyError.response.status);
            log('Qveris: Error response data: ' + JSON.stringify(getKeyError.response.data, null, 2));
          }
          
          // If failed with name and we have an ID, try with ID
          if (firstKey.id && getKeyError?.response?.status === 404) {
            log('Qveris: Trying to get full key using ID instead of name...');
            try {
              const getFullKeyUrlById = `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.id)}`;
              log('Qveris: Get full key endpoint URL (using ID): ' + getFullKeyUrlById);
              const fullKeyRespById = await axios.get(getFullKeyUrlById, { headers, timeout: 15000 });
              log('Qveris: Get full key response status (using ID): ' + fullKeyRespById.status);
              log('Qveris: Get full key response data (using ID): ' + JSON.stringify(fullKeyRespById.data, null, 2));
              
              if (fullKeyRespById.data?.status === 'success' && fullKeyRespById.data?.data?.api_key) {
                apiKey = fullKeyRespById.data.data.api_key;
                log('Qveris: ✅ Successfully retrieved existing API key using ID');
              } else {
                log('Qveris: ❌ Get full key response (using ID) does not contain API key');
              }
            } catch (getKeyErrorById: any) {
              log('Qveris: ❌ Error getting full key with ID: ' + (getKeyErrorById?.message || getKeyErrorById));
              if (getKeyErrorById?.response) {
                log('Qveris: Error response status (using ID): ' + getKeyErrorById.response.status);
                log('Qveris: Error response data (using ID): ' + JSON.stringify(getKeyErrorById.response.data, null, 2));
              }
              // ignore and fallback to create
            }
          } else {
            // ignore and fallback to create
          }
        }
      }
    } else {
      log('Qveris: List API keys response does not contain valid keys array');
    }
  } catch (listError: any) {
    log('Qveris: ❌ Error listing API keys: ' + (listError?.message || listError));
    log('Qveris: Error type: ' + (listError?.constructor?.name || 'unknown'));
    if (listError?.stack) {
      log('Qveris: Error stack: ' + listError.stack);
    }
    
    // Log request details
    if (listError?.config) {
      log('Qveris: Failed request URL: ' + (listError.config.url || 'unknown'));
      log('Qveris: Failed request method: ' + (listError.config.method || 'unknown'));
      log('Qveris: Failed request baseURL: ' + (listError.config.baseURL || 'unknown'));
      log('Qveris: Failed request headers: ' + JSON.stringify({
        ...listError.config.headers,
        Authorization: listError.config.headers?.Authorization ? 
          `Bearer ${listError.config.headers.Authorization.replace('Bearer ', '').substring(0, 20)}...` : 
          'missing'
      }, null, 2));
      log('Qveris: Failed request timeout: ' + (listError.config.timeout || 'unknown'));
    }
    
    if (listError?.request) {
      log('Qveris: Request was sent but no response received');
      log('Qveris: Request path: ' + (listError.request.path || 'unknown'));
      log('Qveris: Request host: ' + (listError.request.host || 'unknown'));
    }
    
    if (listError?.response) {
      log('Qveris: Error response status: ' + listError.response.status);
      log('Qveris: Error response status text: ' + listError.response.statusText);
      log('Qveris: Error response data: ' + JSON.stringify(listError.response.data, null, 2));
      log('Qveris: Error response headers: ' + JSON.stringify(listError.response.headers, null, 2));
    }
    
    // ignore and create
  }

  // Create a fresh key if none found
  if (!apiKey) {
    log('Qveris: No existing API key found, creating a new one...');
    const config = vscode.workspace.getConfiguration('qverisAi');
    const requestedName = config.get<string>('apiKeyName') || 'vscode';
    const name = `${requestedName}-${Date.now()}`;
    log('Qveris: Creating API key with name: ' + name);

    try {
      const createApiKeyUrl = `${baseUrl}/rpc/v1/auth/api-keys/create`;
      log('Qveris: Sending create API key request...');
      log('Qveris: Create API key endpoint URL: ' + createApiKeyUrl);
      log('Qveris: Request method: POST');
      log('Qveris: Request body: ' + JSON.stringify({ name }, null, 2));
      log('Qveris: Request headers: ' + JSON.stringify({
        Authorization: headers.Authorization ? `Bearer ${accessToken.substring(0, 20)}...` : 'missing',
        'Content-Type': 'application/json'
      }, null, 2));
      log('Qveris: Authorization token length: ' + accessToken.length);
      log('Qveris: Authorization token preview: ' + accessToken.substring(0, 50) + '...');
      log('Qveris: Request timeout: 15000ms');
      const createResp = await axios.post(createApiKeyUrl, { name }, { headers, timeout: 15000 });
      log('Qveris: Create API key response status: ' + createResp.status);
      log('Qveris: Create API key response status text: ' + createResp.statusText);
      log('Qveris: Create API key response headers: ' + JSON.stringify(createResp.headers, null, 2));
      log('Qveris: Create API key response data: ' + JSON.stringify(createResp.data, null, 2));
      
      if (createResp.data?.status === 'success' && createResp.data?.data?.api_key) {
        apiKey = createResp.data.data.api_key;
        log('Qveris: ✅ Successfully created new API key');
      } else {
        const errorMsg = createResp.data?.message || 'Unable to create API key';
        log('Qveris: ❌ Create API key failed: ' + errorMsg);
        log('Qveris: Full response: ' + JSON.stringify(createResp.data, null, 2));
        throw new Error(errorMsg);
      }
    } catch (createError: any) {
      log('Qveris: ❌ Exception while creating API key: ' + (createError?.message || createError));
      log('Qveris: Error type: ' + (createError?.constructor?.name || 'unknown'));
      if (createError?.stack) {
        log('Qveris: Error stack: ' + createError.stack);
      }
      
      // Log request details
      if (createError?.config) {
        log('Qveris: Failed request URL: ' + (createError.config.url || 'unknown'));
        log('Qveris: Failed request method: ' + (createError.config.method || 'unknown'));
        log('Qveris: Failed request baseURL: ' + (createError.config.baseURL || 'unknown'));
        log('Qveris: Failed request data: ' + JSON.stringify(createError.config.data, null, 2));
        log('Qveris: Failed request headers: ' + JSON.stringify({
          ...createError.config.headers,
          Authorization: createError.config.headers?.Authorization ? 
            `Bearer ${createError.config.headers.Authorization.replace('Bearer ', '').substring(0, 20)}...` : 
            'missing'
        }, null, 2));
        log('Qveris: Failed request timeout: ' + (createError.config.timeout || 'unknown'));
      }
      
      if (createError?.request) {
        log('Qveris: Request was sent but no response received');
        log('Qveris: Request path: ' + (createError.request.path || 'unknown'));
        log('Qveris: Request host: ' + (createError.request.host || 'unknown'));
      }
      
      if (createError?.response) {
        log('Qveris: Error response status: ' + createError.response.status);
        log('Qveris: Error response status text: ' + createError.response.statusText);
        log('Qveris: Error response data: ' + JSON.stringify(createError.response.data, null, 2));
        log('Qveris: Error response headers: ' + JSON.stringify(createError.response.headers, null, 2));
        
        // Check if it's an authentication error
        if (createError.response.status === 401 || createError.response.status === 403) {
          const errorData = createError.response.data;
          const errorMsg = errorData?.message || errorData?.error || 'Invalid token';
          log('Qveris: Authentication error detected: ' + errorMsg);
          throw new Error(errorMsg);
        }
      }
      
      throw createError;
    }
  }

  if (!apiKey) {
    throw new Error('Failed to obtain API key');
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
    log('Qveris: decodeJwtPayload - token length: ' + token.length);
    
    const parts = token.split('.');
    log('Qveris: decodeJwtPayload - parts count: ' + parts.length);
    
    if (parts.length !== 3) {
      log('Qveris: Invalid JWT format - expected 3 parts, got ' + parts.length);
      throw new Error(`Invalid JWT token format: expected 3 parts, got ${parts.length}`);
    }

    log('Qveris: decodeJwtPayload - payload part length: ' + parts[1].length);
    
    // Base64 decode the payload
    const decoded = Buffer.from(parts[1], 'base64').toString();
    log('Qveris: decodeJwtPayload - decoded payload length: ' + decoded.length);
    log('Qveris: decodeJwtPayload - decoded payload preview: ' + decoded.substring(0, 100));
    
    const payload = JSON.parse(decoded);
    log('Qveris: decodeJwtPayload - JSON parse successful');
    
    return payload;
  } catch (error: any) {
    log('Qveris: JWT decode error: ' + (error?.message || error));
    log('Qveris: JWT decode error type: ' + (error?.constructor?.name || 'unknown'));
    if (error?.stack) {
      log('Qveris: JWT decode error stack: ' + error.stack);
    }
    return null;
  }
}

export function deactivate() {
  // Nothing to cleanup
}
