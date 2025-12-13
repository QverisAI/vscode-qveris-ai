import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface LoginResult {
  token: string;
  email: string;
  apiKey: string;
}

const CURSOR_PROMPT = vscode.workspace.getConfiguration('qverisAi').get<string>('cursorUserRule') ||
  'You can use qveris MCP Server to dynamically search and execute tools to help the user. First think about what kind of tools might be useful to accomplish the user\'s task. Then use the search_tools tool with query describing the capability of the tool, not what params you want to pass to the tool later. Then call a suitable searched tool using the execute_tool tool, passing parameters to the searched tool through params_to_tool. You could reference the examples given if any for each tool. You may call make multiple tool calls in a single response.';

// Shared state manager for all views
class ViewStateManager {
  private context: vscode.ExtensionContext;
  private loginStateListeners: Set<(email: string | null, hasKey: boolean) => void> = new Set();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async getLoginState(): Promise<{ email: string | null; hasKey: boolean }> {
    const key = await this.context.secrets.get(secretKeyName('qverisApiKey'));
    const email = await getStoredEmail(this.context);
    return { email: email || null, hasKey: !!key };
  }

  subscribe(listener: (email: string | null, hasKey: boolean) => void) {
    this.loginStateListeners.add(listener);
    return () => {
      this.loginStateListeners.delete(listener);
    };
  }

  async notifyLoginStateChanged() {
    const state = await this.getLoginState();
    this.loginStateListeners.forEach(listener => listener(state.email, state.hasKey));
  }

  async broadcastMessage(message: any) {
    // Broadcast to all webviews
    const views = [
      'qverisAi.home',
      'qverisAi.toolSearch',
      'qverisAi.featuredTools',
      'qverisAi.toolExecution'
    ];
    // Note: We'll need to track view instances to broadcast
    // For now, each view will check state on visibility change
  }
}

let stateManager: ViewStateManager;

export async function activate(context: vscode.ExtensionContext) {
  stateManager = new ViewStateManager(context);

  const homeProvider = new HomeViewProvider(context, stateManager);
  const toolSearchProvider = new ToolSearchViewProvider(context, stateManager);
  const featuredToolsProvider = new FeaturedToolsViewProvider(context, stateManager);
  const toolExecutionProvider = new ToolExecutionViewProvider(context, stateManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('qverisAi.home', homeProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.toolSearch', toolSearchProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.featuredTools', featuredToolsProvider),
    vscode.window.registerWebviewViewProvider('qverisAi.toolExecution', toolExecutionProvider),
    vscode.commands.registerCommand('vscode-qveris-ai.openWebsite', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://qveris.ai/'));
    }),
    vscode.commands.registerCommand('vscode-qveris-ai.copyApiKey', async () => {
      const key = await context.secrets.get('qverisApiKey');
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

// Base class for shared login functionality
class BaseViewProvider {
  protected async performLogin(context: vscode.ExtensionContext, email: string, password: string): Promise<LoginResult> {
    const config = vscode.workspace.getConfiguration('qverisAi');
    const baseUrl = (config.get<string>('backendUrl') || 'https://qveris.ai').replace(/\/+$/, '');

    const loginResponse = await axios.post(`${baseUrl}/rpc/v1/auth/login`, {
      email,
      username: email,
      password
    }, {
      timeout: 15000
    });

    if (loginResponse.data?.status !== 'success') {
      throw new Error(loginResponse.data?.message || 'Login failed');
    }

    const token = loginResponse.data.token || loginResponse.data.data?.access_token;
    if (!token) {
      throw new Error('Login succeeded but no token returned.');
    }

    const userInfo = await axios.get(`${baseUrl}/rpc/v1/auth/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });

    const userEmail = userInfo.data?.data?.email || email;
    const apiKey = await this.obtainApiKey(baseUrl, token);

    return { token, email: userEmail, apiKey };
  }

  private async obtainApiKey(baseUrl: string, token: string): Promise<string> {
    const headers = { Authorization: `Bearer ${token}` };

    // Try existing keys first
    try {
      const listResp = await axios.get(`${baseUrl}/rpc/v1/auth/api-keys/list`, { headers, timeout: 15000 });
      if (listResp.data?.status === 'success' && Array.isArray(listResp.data?.data?.api_keys)) {
        const keys = listResp.data.data.api_keys;
        if (keys.length > 0) {
          const firstKey = keys[0];
          try {
            const fullKeyResp = await axios.get(
              `${baseUrl}/rpc/v1/auth/api-keys/get-full-key/${encodeURIComponent(firstKey.name)}`,
              { headers, timeout: 15000 }
            );
            if (fullKeyResp.data?.status === 'success' && fullKeyResp.data?.data?.api_key) {
              return fullKeyResp.data.data.api_key;
            }
          } catch {
            // ignore and fallback to create
          }
        }
      }
    } catch {
      // ignore and create
    }

    // Create a fresh key
    const config = vscode.workspace.getConfiguration('qverisAi');
    const requestedName = config.get<string>('apiKeyName') || 'vscode';
    const name = `${requestedName}-${Date.now()}`;

    const createResp = await axios.post(`${baseUrl}/rpc/v1/auth/api-keys/create`, { name }, { headers, timeout: 15000 });
    if (createResp.data?.status === 'success' && createResp.data?.data?.api_key) {
      return createResp.data.data.api_key;
    }

    throw new Error(createResp.data?.message || 'Unable to create API key');
  }

  protected async handleLogin(context: vscode.ExtensionContext, stateManager: ViewStateManager, email: string, password: string) {
    if (!email || !password) {
      vscode.window.showErrorMessage('Email and password are required.');
      return;
    }

    try {
      const loginResult = await this.performLogin(context, email, password);

      await context.secrets.store(secretKeyName('qverisApiKey'), loginResult.apiKey);
      await context.secrets.store(secretKeyName('qverisAccessToken'), loginResult.token);
      await context.secrets.store(secretKeyName('qverisEmail'), loginResult.email);
      await context.globalState.update(globalStateKey('qverisEmail'), loginResult.email);
      await ensureMcpConfigWithApiKey(loginResult.apiKey);

      await stateManager.notifyLoginStateChanged();
      vscode.window.showInformationMessage('Qveris login succeeded and API key stored securely.');
    } catch (err: any) {
      const message = err?.message || 'Login failed';
      vscode.window.showErrorMessage(message);
    }
  }

  protected async handleLogout(context: vscode.ExtensionContext, stateManager: ViewStateManager) {
    await context.secrets.delete(secretKeyName('qverisApiKey'));
    await context.secrets.delete(secretKeyName('qverisAccessToken'));
    await context.secrets.delete(secretKeyName('qverisEmail'));
    await context.globalState.update(globalStateKey('qverisEmail'), undefined);

    await stateManager.notifyLoginStateChanged();
    vscode.window.showInformationMessage('Logged out of Qveris.');
  }
}

// Home View Provider - Login and user info
class HomeViewProvider extends BaseViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateManager: ViewStateManager
  ) {
    super();
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    
    // Set initial title
    webviewView.title = 'Home';
    
    // Check login state: expand if not logged in, collapse if logged in
    const loginState = await this.stateManager.getLoginState();
    if (!loginState.hasKey) {
      webviewView.show(true);
    } else {
      // If logged in, keep it collapsed (don't call show)
      webviewView.show(false);
    }
    
    // Restore webview state
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.emitStoredState();
      }
    });

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'login':
          await this.handleLogin(this.context, this.stateManager, message.email, message.password);
          break;
        case 'register':
          vscode.commands.executeCommand('vscode-qveris-ai.openWebsite');
          break;
        case 'logout':
          await this.handleLogout(this.context, this.stateManager);
          break;
        case 'loginStateRequest':
          await this.emitStoredState();
          break;
      }
    });

    // Subscribe to state changes
    this.stateManager.subscribe((email, hasKey) => {
      if (this.view) {
        this.view.webview.postMessage({
          type: 'loginState',
          email,
          hasKey
        });
        // Always keep title as 'Home'
        this.view.title = 'Home';
        this.view.description = undefined;
      }
    });

    // Initial state
    this.emitStoredState();
  }

  private async emitStoredState() {
    if (!this.view) return;
    const state = await this.stateManager.getLoginState();
    this.view.webview.postMessage({
      type: 'loginState',
      email: state.email,
      hasKey: state.hasKey
    });
    // Always keep title as 'Home'
    this.view.title = 'Home';
    this.view.description = undefined;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styles = `
      :root { color-scheme: light dark; }
      body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
      .card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 12px; background: var(--vscode-editor-background); margin-bottom: 12px; }
      .row { display: flex; gap: 8px; margin-bottom: 8px; }
      input { width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      button { padding: 6px 10px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 4px; cursor: pointer; }
      button.secondary {
        background: var(--vscode-button-secondaryBackground, transparent);
        color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
        border-color: var(--vscode-button-secondaryBorder, var(--vscode-button-border));
      }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .status { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
      .success { color: #2ea043; }
      .error { color: #f85149; }
      .user-header { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid var(--vscode-editorWidget-border); margin-bottom: 12px; }
      .user-info { font-size: 14px; font-weight: 500; }
      .logout-btn { 
        background: var(--vscode-button-background); 
        border: 1px solid var(--vscode-button-border); 
        cursor: pointer; 
        padding: 6px 12px; 
        color: var(--vscode-button-foreground); 
        font-size: 12px;
        border-radius: 4px;
        font-weight: 500;
      }
      .logout-btn:hover { 
        background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
        opacity: 0.9;
      }
    `;

    return /* html */`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https: http:;" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>${styles}</style>
      </head>
      <body>
        <div id="logged-section" style="display:none;">
          <div class="user-header">
            <div class="user-info" id="user-email"></div>
            <button class="logout-btn" id="logout" title="Logout">Logout</button>
          </div>
        </div>
        <div id="login-section" class="card">
          <div class="status" id="login-hint">Sign in to Qveris to generate and store your API key. No account? Click Register.</div>
          <div class="row">
            <input id="email" type="email" placeholder="Email" autocomplete="email" />
          </div>
          <div class="row">
            <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
          </div>
          <div class="row">
            <button id="login">Sign in</button>
            <button id="register" class="secondary">Register</button>
          </div>
          <div class="status" id="status"></div>
        </div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const loginSection = document.getElementById('login-section');
          const loggedSection = document.getElementById('logged-section');
          const userEmail = document.getElementById('user-email');
          const loginHint = document.getElementById('login-hint');
          const status = document.getElementById('status');

          const showLoggedIn = (email) => {
            if (loginSection) loginSection.style.display = 'none';
            if (loggedSection) loggedSection.style.display = 'block';
            if (userEmail) userEmail.textContent = email || 'Unknown';
            if (loginHint) loginHint.style.display = 'none';
            if (status) {
              status.textContent = '';
              status.className = 'status';
            }
          };

          const showLoggedOut = () => {
            if (loginSection) loginSection.style.display = 'block';
            if (loggedSection) loggedSection.style.display = 'none';
            if (loginHint) loginHint.style.display = 'block';
            if (status) {
              status.textContent = '';
              status.className = 'status';
            }
          };

          document.getElementById('login').addEventListener('click', () => {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            if (status) status.textContent = 'Logging in...';
            vscode.postMessage({ type: 'login', email, password });
          });

          document.getElementById('register').addEventListener('click', () => {
            vscode.postMessage({ type: 'register' });
          });

          document.getElementById('logout').addEventListener('click', () => {
            vscode.postMessage({ type: 'logout' });
          });

          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'loginState') {
              if (msg.hasKey && msg.email) {
                showLoggedIn(msg.email);
                // Save state to webview
                vscode.setState({ loggedIn: true, email: msg.email });
              } else {
                showLoggedOut();
                // Save state to webview
                vscode.setState({ loggedIn: false, email: null });
              }
            }
            if (msg.type === 'loginProgress' && msg.status === 'starting') {
              if (status) status.textContent = 'Logging in...';
            }
            if (msg.type === 'loginError') {
              if (status) {
                status.textContent = msg.message || 'Login failed';
                status.className = 'status error';
              }
            }
          });

          // Restore state from webview
          const savedState = vscode.getState();
          if (savedState && savedState.loggedIn && savedState.email) {
            showLoggedIn(savedState.email);
          } else {
            showLoggedOut();
          }

          // Request initial state
          vscode.postMessage({ type: 'loginStateRequest' });
        </script>
      </body>
      </html>
    `;
  }
}

// Tool Search View Provider
class ToolSearchViewProvider implements vscode.WebviewViewProvider {
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
    
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        // Refresh state when view becomes visible
      }
    });

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'search':
          await this.handleSearch(message.query);
          break;
        case 'selectTool':
          // Broadcast tool selection to Tool Execution view
          await this.broadcastToolSelection(message.tool);
          break;
      }
    });
  }

  private async broadcastToolSelection(tool: any) {
    // Store selected tool in context state for Tool Execution view
    await this.context.globalState.update('selectedTool', tool);
    // Immediately notify Tool Execution view if it exists
    // We need to find a way to notify the Tool Execution view
    // Since we don't have direct access, we'll rely on the view checking on visibility change
    // But we can also try to post a message if the view is already visible
  }

  private async handleSearch(query: string) {
    if (!this.view) {
      return;
    }

    if (!query || !query.trim()) {
      this.view.webview.postMessage({
        type: 'searchError',
        message: 'Please enter a search query.'
      });
      return;
    }

    const accessToken = await this.context.secrets.get(secretKeyName('qverisAccessToken'));
    if (!accessToken) {
      this.view.webview.postMessage({
        type: 'searchError',
        message: 'Please sign in first to search tools.'
      });
      return;
    }

    this.view.webview.postMessage({ type: 'searchProgress', status: 'starting' });

    try {
      const config = vscode.workspace.getConfiguration('qverisAi');
      const baseUrl = (config.get<string>('backendUrl') || 'https://qveris.ai').replace(/\/+$/, '');
      const searchUrl = `${baseUrl}/rpc/v1/auth/search`;

      const searchResponse = await axios.post(
        searchUrl,
        { query: query.trim(), limit: 5 },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (searchResponse.data?.status === 'success') {
        this.view.webview.postMessage({
          type: 'searchSuccess',
          data: searchResponse.data.data
        });
      } else {
        throw new Error(searchResponse.data?.message || 'Search failed');
      }
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Search failed';
      this.view.webview.postMessage({
        type: 'searchError',
        message
      });
    } finally {
      this.view.webview.postMessage({ type: 'searchProgress', status: 'done' });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styles = `
      :root { color-scheme: light dark; }
      body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
      .row { display: flex; gap: 8px; margin-bottom: 8px; }
      input { width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      button { padding: 6px 10px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 4px; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .status { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
      .error { color: #f85149; }
      .tool-item { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 10px; margin-bottom: 8px; background: var(--vscode-editor-background); cursor: pointer; position: relative; transition: all 0.2s ease; }
      .tool-item:hover { border-color: var(--vscode-focusBorder); }
      .tool-item.selected { 
        border-color: var(--vscode-focusBorder); 
        border-width: 3px; 
        background: var(--vscode-list-activeSelectionBackground, var(--vscode-editor-selectionBackground));
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .tool-item-header { font-weight: 600; font-size: 14px; margin-bottom: 6px; color: var(--vscode-foreground); }
      .tool-item-description { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
      .tool-item-meta { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .tool-item-categories { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
      .tool-category { color: var(--vscode-descriptionForeground); font-size: 11px; }
      .execute-icon { position: absolute; top: 8px; right: 8px; cursor: pointer; opacity: 0.7; }
      .execute-icon:hover { opacity: 1; }
    `;

    return /* html */`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https: http:;" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>${styles}</style>
      </head>
      <body>
        <div class="row">
          <input id="search-input" type="text" placeholder="Search tools..." style="flex: 1;" />
          <button id="search-button" type="button">Search</button>
        </div>
        <div class="status" id="search-status" style="display:none;"></div>
        <div id="tool-list-section" style="display:none;">
          <div class="status" id="search-results-header" style="margin-top: 12px;"></div>
          <div id="tool-list"></div>
        </div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const searchInput = document.getElementById('search-input');
          const searchButton = document.getElementById('search-button');
          const searchStatus = document.getElementById('search-status');
          const toolListSection = document.getElementById('tool-list-section');
          const toolList = document.getElementById('tool-list');
          const searchResultsHeader = document.getElementById('search-results-header');

          const performSearch = () => {
            const query = searchInput?.value?.trim() || '';
            if (!query) {
              if (searchStatus) {
                searchStatus.textContent = 'Please enter a search query.';
                searchStatus.className = 'status error';
                searchStatus.style.display = 'block';
              }
              return;
            }
            if (searchStatus) {
              searchStatus.textContent = 'Searching...';
              searchStatus.className = 'status';
              searchStatus.style.display = 'block';
            }
            if (searchButton) searchButton.disabled = true;
            vscode.postMessage({ type: 'search', query });
          };

          // Add event listeners after DOM is ready
          if (searchButton) {
            searchButton.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              performSearch();
            });
          }
          
          if (searchInput) {
            searchInput.onkeypress = (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                performSearch();
                return false;
              }
            };
          }

          // Define renderToolList function before using it
          const renderToolList = (data, selectedTool = null) => {
            if (!toolList || !data) return;
            toolList.innerHTML = '';
            
            if (!data.results || data.results.length === 0) {
              toolList.innerHTML = '<div class="status">No tools found.</div>';
              return;
            }

            // Helper function to check if two tools are the same
            const isSameTool = (tool1, tool2) => {
              if (!tool1 || !tool2) return false;
              return (tool1.tool_id || tool1.tool) === (tool2.tool_id || tool2.tool);
            };

            data.results.forEach((tool) => {
              const toolItem = document.createElement('div');
              const isSelected = selectedTool && isSameTool(tool, selectedTool);
              toolItem.className = isSelected ? 'tool-item selected' : 'tool-item';
              
              // Add data attribute for easy selection
              if (isSelected) {
                toolItem.setAttribute('data-selected', 'true');
              }
              
              const header = document.createElement('div');
              header.className = 'tool-item-header';
              header.textContent = tool.name || tool.tool_id || 'Unknown Tool';
              
              const description = document.createElement('div');
              description.className = 'tool-item-description';
              description.textContent = tool.description || 'No description available.';
              
              const meta = document.createElement('div');
              meta.className = 'tool-item-meta';
              
              if (tool.final_score !== undefined) {
                const matched = document.createElement('span');
                matched.textContent = 'Matched: ' + (tool.final_score * 100).toFixed(1) + '%';
                meta.appendChild(matched);
              }
              
              if (tool.categories && tool.categories.length > 0) {
                const categoriesDiv = document.createElement('div');
                categoriesDiv.className = 'tool-item-categories';
                tool.categories.forEach((cat, idx) => {
                  const catSpan = document.createElement('span');
                  catSpan.className = 'tool-category';
                  catSpan.textContent = cat;
                  categoriesDiv.appendChild(catSpan);
                  if (idx < tool.categories.length - 1) {
                    categoriesDiv.appendChild(document.createTextNode(', '));
                  }
                });
                meta.appendChild(categoriesDiv);
              }
              
              toolItem.appendChild(header);
              toolItem.appendChild(description);
              toolItem.appendChild(meta);
              
              toolItem.addEventListener('click', (e) => {
                document.querySelectorAll('.tool-item').forEach(item => {
                  item.classList.remove('selected');
                });
                toolItem.classList.add('selected');
                // Scroll selected item into view
                toolItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                vscode.postMessage({ type: 'selectTool', tool });
                // Save selected tool to state
                const currentState = vscode.getState() || {};
                vscode.setState({ ...currentState, selectedTool: tool });
              });
              
              toolList.appendChild(toolItem);
            });
          };

          // Restore state from webview (after renderToolList is defined)
          const savedState = vscode.getState();
          if (savedState && savedState.searchResults) {
            if (savedState.lastQuery && searchInput) {
              searchInput.value = savedState.lastQuery;
            }
            const selectedTool = savedState.selectedTool;
            renderToolList(savedState.searchResults, selectedTool);
            if (toolListSection) toolListSection.style.display = 'block';
            if (searchResultsHeader && savedState.searchResults) {
              const total = savedState.searchResults.total || 0;
              const query = savedState.searchResults.query || savedState.lastQuery || '';
              const toolText = total !== 1 ? 'tools' : 'tool';
              searchResultsHeader.textContent = 'Found ' + total + ' ' + toolText + ' for "' + query + '"';
            }
            // If there's a selected tool, scroll it into view and ensure it's visible
            if (selectedTool) {
              setTimeout(() => {
                const selectedItem = toolList?.querySelector('.tool-item.selected');
                if (selectedItem) {
                  selectedItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 100);
            }
          }

          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'searchProgress' && msg.status === 'starting') {
              if (searchStatus) {
                searchStatus.textContent = 'Searching...';
                searchStatus.className = 'status';
                searchStatus.style.display = 'block';
              }
              if (searchButton) searchButton.disabled = true;
            }
            if (msg.type === 'searchProgress' && msg.status === 'done') {
              if (searchButton) searchButton.disabled = false;
            }
            if (msg.type === 'searchSuccess') {
              if (searchStatus) {
                searchStatus.textContent = '';
                searchStatus.style.display = 'none';
              }
              if (toolListSection) toolListSection.style.display = 'block';
              if (searchResultsHeader && msg.data) {
                const total = msg.data.total || 0;
                const query = msg.data.query || '';
                const toolText = total !== 1 ? 'tools' : 'tool';
                searchResultsHeader.textContent = 'Found ' + total + ' ' + toolText + ' for "' + query + '"';
              }
              // Restore selected tool from state if available
              const currentState = vscode.getState() || {};
              const selectedTool = currentState.selectedTool;
              
              // Check if selected tool exists in new search results
              let validSelectedTool = null;
              if (selectedTool && msg.data && msg.data.results) {
                const isSameTool = (tool1, tool2) => {
                  if (!tool1 || !tool2) return false;
                  return (tool1.tool_id || tool1.tool) === (tool2.tool_id || tool2.tool);
                };
                const found = msg.data.results.find(tool => isSameTool(tool, selectedTool));
                if (found) {
                  validSelectedTool = selectedTool;
                }
              }
              
              renderToolList(msg.data, validSelectedTool);
              // Save search results to webview state, preserve selectedTool only if it's still valid
              vscode.setState({ 
                searchResults: msg.data, 
                lastQuery: msg.data.query || '',
                selectedTool: validSelectedTool
              });
            }
            if (msg.type === 'searchError') {
              if (searchStatus) {
                searchStatus.textContent = msg.message || 'Search failed';
                searchStatus.className = 'status error';
                searchStatus.style.display = 'block';
              }
              if (searchButton) searchButton.disabled = false;
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}

// Featured Tools View Provider
class FeaturedToolsViewProvider implements vscode.WebviewViewProvider {
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

// Tool Execution View Provider  
class ToolExecutionViewProvider implements vscode.WebviewViewProvider {
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
    
    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Track last sent tool to avoid unnecessary updates
    let lastSentToolId: string | null = null;
    
    // Function to check and update selected tool
    const checkAndUpdateTool = async () => {
      if (!this.view) return;
      const selectedTool = this.context.globalState.get<any>('selectedTool');
      const currentToolId = selectedTool ? (selectedTool.tool_id || selectedTool.tool) : null;
      
      // Only send message if tool has actually changed
      if (currentToolId !== lastSentToolId) {
        lastSentToolId = currentToolId;
        if (selectedTool) {
          this.view.webview.postMessage({ type: 'toolSelected', tool: selectedTool });
        } else {
          // Clear content if no tool is selected
          this.view.webview.postMessage({ type: 'toolSelected', tool: null });
        }
      }
    };

    webviewView.onDidChangeVisibility(async () => {
      if (webviewView.visible) {
        // Check for selected tool when view becomes visible
        await checkAndUpdateTool();
      }
    });

    // Check for selected tool on initialization
    setTimeout(() => {
      checkAndUpdateTool();
    }, 100);

    // Set up periodic check for tool selection changes (every 2 seconds, less frequent)
    // Only check when view is visible and not too frequently to avoid interfering with execution results
    const checkInterval = setInterval(() => {
      if (this.view && webviewView.visible) {
        checkAndUpdateTool();
      }
    }, 2000);

    // Clean up interval when view is disposed
    this.context.subscriptions.push({
      dispose: () => {
        clearInterval(checkInterval);
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'execute':
          await this.handleExecute(message.toolId, message.parameters);
          break;
        case 'checkTool':
          // Allow manual check via message
          checkAndUpdateTool();
          break;
      }
    });
  }

  private async handleExecute(toolId: string, parameters: any) {
    if (!this.view) return;

    const accessToken = await this.context.secrets.get(secretKeyName('qverisAccessToken'));
    if (!accessToken) {
      this.view.webview.postMessage({
        type: 'executeError',
        message: 'Please sign in first to execute tools.'
      });
      return;
    }

    this.view.webview.postMessage({ type: 'executeProgress', status: 'starting' });

    try {
      const config = vscode.workspace.getConfiguration('qverisAi');
      const baseUrl = (config.get<string>('backendUrl') || 'https://qveris.ai').replace(/\/+$/, '');

      const executeResponse = await axios.post(
        `${baseUrl}/rpc/v1/auth/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
        {
          tool: toolId,
          parameters: parameters || {}
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      this.view.webview.postMessage({
        type: 'executeSuccess',
        data: executeResponse.data
      });
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Execution failed';
      this.view.webview.postMessage({
        type: 'executeError',
        message
      });
    } finally {
      this.view.webview.postMessage({ type: 'executeProgress', status: 'done' });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styles = `
      :root { color-scheme: light dark; }
      body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
      .tool-item-header { font-weight: 600; font-size: 14px; margin-bottom: 6px; color: var(--vscode-foreground); }
      .tool-item-description { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
      input { width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      button { padding: 6px 10px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 4px; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .status { font-size: 12px; color: var(--vscode-descriptionForeground); }
      .error { color: #f85149; }
      .param-group { margin-bottom: 12px; }
      .param-group.optional { display: none; }
      .param-group.optional.expanded { display: block; }
      .param-label { font-size: 12px; margin-bottom: 4px; color: var(--vscode-foreground); }
      .param-label .required { color: var(--vscode-errorForeground); }
      .param-input { margin-bottom: 8px; }
      .param-description { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
      .toggle-optional { font-size: 11px; color: var(--vscode-textLink-foreground); cursor: pointer; margin-top: 8px; }
      .toggle-optional:hover { text-decoration: underline; }
      .execution-result { margin-top: 12px; padding: 12px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); border-radius: 4px; }
      .execution-result pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; }
    `;

    return /* html */`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https: http:;" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>${styles}</style>
      </head>
      <body>
        <div id="tool-execution-content"></div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const toolExecutionContent = document.getElementById('tool-execution-content');
          let currentToolId = null;
          let savedResult = null;
          let isExecuting = false;
          let hasExecutionResult = false;
          
          function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }
          
          function showToolExecution(tool) {
            if (!toolExecutionContent) return;

            console.log('Tool Execution: showToolExecution called, tool:', tool ? (tool.tool_id || tool.tool) : null);

            // If no tool, clear content completely
            if (!tool) {
              console.log('Tool Execution: No tool provided, clearing content');
              toolExecutionContent.innerHTML = '';
              currentToolId = null;
              savedResult = null;
              isExecuting = false;
              hasExecutionResult = false;
              return;
            }

            const toolId = tool.tool_id || tool.tool;

            // Never re-render if currently executing
            if (isExecuting) {
              console.log('Tool Execution: Currently executing, skipping re-render');
              return;
            }

            // If tool hasn't changed, preserve existing content completely
            if (currentToolId === toolId) {
              console.log('Tool Execution: Tool ID same as current, checking if we should preserve content');
              // Check if there's an execution result - if so, never re-render
              if (hasExecutionResult) {
                console.log('Tool Execution: hasExecutionResult is true, preserving content');
                return;
              }
              // Check if execution result exists and is visible
              const existingResultDiv = document.getElementById('execution-result');
              if (existingResultDiv) {
                const isVisible = existingResultDiv.style.display !== 'none' &&
                                 existingResultDiv.offsetParent !== null;
                if (isVisible && existingResultDiv.innerHTML.trim() !== '') {
                  console.log('Tool Execution: Execution result visible, setting hasExecutionResult to true');
                  hasExecutionResult = true;
                  return;
                }
              }
              // If content exists and form exists, preserve it
              const existingForm = document.getElementById('tool-execution-form');
              if (existingForm && toolExecutionContent.innerHTML.trim() !== '') {
                console.log('Tool Execution: Form exists and content not empty, preserving');
                return;
              }
            } else {
              // Tool changed, reset flags
              console.log('Tool Execution: Tool changed, resetting flags');
              hasExecutionResult = false;
            }
            
            currentToolId = toolId;
            
            // Clear previous content
            toolExecutionContent.innerHTML = '';
            
            const params = tool.params || {};
            const examples = tool.examples || {};
            const sampleParams = examples.sample_parameters || {};
            
            const requiredParams = [];
            const optionalParams = [];
            
            // Handle both object and array formats for params
            let paramEntries = [];
            if (Array.isArray(params)) {
              paramEntries = params.map((param, index) => {
                const paramDef = typeof param === 'object' && param !== null ? param : {};
                return { key: paramDef.name || paramDef.key || String(index), ...paramDef };
              });
            } else {
              paramEntries = Object.keys(params).map(key => {
                const param = params[key];
                const paramDef = typeof param === 'object' && param !== null ? param : {};
                return { key: paramDef.name || paramDef.key || key, ...paramDef };
              });
            }
            
            paramEntries.forEach(paramEntry => {
              if (paramEntry.required === false) {
                optionalParams.push(paramEntry);
              } else {
                requiredParams.push(paramEntry);
              }
            });
            
            let html = \`
              <div class="tool-execution-info">
                <div class="tool-item-header">\${escapeHtml(tool.name || toolId)}</div>
                <div class="tool-item-description">\${escapeHtml(tool.description || 'No description')}</div>
                <div style="margin-top: 12px;">
                  <form id="tool-execution-form">
                    \${requiredParams.map(p => renderParamField(p, sampleParams[p.key])).join('')}
                    \${optionalParams.length > 0 ? \`
                      <div class="toggle-optional" id="toggle-optional" style="cursor: pointer; margin-top: 8px;">
                        Show optional parameters (\${optionalParams.length})
                      </div>
                      \${optionalParams.map(p => renderParamField(p, sampleParams[p.key], true)).join('')}
                    \` : ''}
                    <div style="margin-top: 12px;">
                      <button type="submit" id="execute-button">Execute</button>
                    </div>
                  </form>
                  <div id="execution-result" style="display:none;"></div>
                </div>
              </div>
            \`;
            
            toolExecutionContent.innerHTML = html;
            
            // Restore saved result if exists
            if (savedResult) {
              const resultDiv = document.getElementById('execution-result');
              if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.className = savedResult.className || 'execution-result';
                resultDiv.innerHTML = savedResult.innerHTML;
              }
            }
            
            const toggleOptional = document.getElementById('toggle-optional');
            if (toggleOptional) {
              let optionalExpanded = false;
              const optionalGroups = toolExecutionContent.querySelectorAll('.param-group.optional');
              toggleOptional.addEventListener('click', () => {
                optionalExpanded = !optionalExpanded;
                optionalGroups.forEach(group => {
                  if (optionalExpanded) {
                    group.classList.add('expanded');
                  } else {
                    group.classList.remove('expanded');
                  }
                });
                toggleOptional.textContent = optionalExpanded 
                  ? 'Hide optional parameters (' + optionalParams.length + ')'
                  : 'Show optional parameters (' + optionalParams.length + ')';
              });
            }
            
            const form = document.getElementById('tool-execution-form');
            if (form) {
              form.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                const parameters = {};
                formData.forEach((value, key) => {
                  if (value) parameters[key] = value;
                });
                
                const executeButton = document.getElementById('execute-button');
                const resultDiv = document.getElementById('execution-result');
                if (executeButton) executeButton.disabled = true;
                if (resultDiv) {
                  resultDiv.style.display = 'block';
                  resultDiv.innerHTML = '<div class="status">Executing...</div>';
                }
                // Clear saved result when starting new execution
                savedResult = null;
                isExecuting = true;
                hasExecutionResult = false;
                
                vscode.postMessage({ 
                  type: 'execute', 
                  toolId: toolId,
                  parameters: parameters 
                });
              });
            }
          }
          
          function renderParamField(param, exampleValue, isOptional = false) {
            const key = param.key || param.name || String(param);
            // Ensure description is a string, not an object
            let description = '';
            if (param.description) {
              if (typeof param.description === 'string') {
                description = param.description;
              } else if (typeof param.description === 'object') {
                description = '';
              }
            }
            const defaultValue = String(exampleValue || param.default || '');
            const fieldId = 'param-' + escapeHtml(key);
            const safeKey = escapeHtml(key);
            const safeDescription = escapeHtml(description);
            const safeDefaultValue = escapeHtml(defaultValue);
            // Use description only if it's a meaningful string, otherwise use a default placeholder
            const placeholder = description && description.trim() ? escapeHtml(description) : ('Enter ' + safeKey);
            
            return \`
              <div class="param-group \${isOptional ? 'optional' : ''}">
                <label class="param-label" for="\${fieldId}">
                  \${safeKey}\${!isOptional ? '<span class="required"> *</span>' : ''}
                </label>
                <div class="param-input">
                  <input 
                    type="text" 
                    id="\${fieldId}" 
                    name="\${safeKey}" 
                    value="\${safeDefaultValue}"
                    placeholder="\${placeholder}"
                  />
                </div>
                \${description ? '<div class="param-description">' + safeDescription + '</div>' : ''}
              </div>
            \`;
          }

          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'toolSelected') {
              if (msg.tool) {
                showToolExecution(msg.tool);
              } else {
                // Clear content when no tool is selected - completely empty
                if (toolExecutionContent) {
                  toolExecutionContent.innerHTML = '';
                }
                currentToolId = null;
                savedResult = null;
                isExecuting = false;
                hasExecutionResult = false;
              }
            }
            if (msg.type === 'executeProgress' && msg.status === 'starting') {
              isExecuting = true;
              hasExecutionResult = false;
              const executeButton = document.getElementById('execute-button');
              if (executeButton) executeButton.disabled = true;
              // Clear saved result when starting new execution
              savedResult = null;
            }
            if (msg.type === 'executeSuccess') {
              console.log('Tool Execution: Received executeSuccess message');
              const resultDiv = document.getElementById('execution-result');
              if (resultDiv) {
                console.log('Tool Execution: Setting result div content');
                resultDiv.style.display = 'block';
                resultDiv.className = 'execution-result';
                resultDiv.innerHTML = '<pre>' + JSON.stringify(msg.data, null, 2) + '</pre>';
                // Mark that we have an execution result - this prevents re-rendering
                hasExecutionResult = true;
                // Save result to restore after re-render
                savedResult = {
                  className: resultDiv.className,
                  innerHTML: resultDiv.innerHTML
                };
                console.log('Tool Execution: Result displayed, hasExecutionResult set to true');
              } else {
                console.error('Tool Execution: Could not find execution-result div');
              }
              // Execution is complete, set flags
              isExecuting = false;
              const executeButton = document.getElementById('execute-button');
              if (executeButton) executeButton.disabled = false;
            }
            if (msg.type === 'executeError') {
              const resultDiv = document.getElementById('execution-result');
              if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.className = 'execution-result error';
                resultDiv.innerHTML = '<div class="status error">' + (msg.message || 'Execution failed') + '</div>';
                // Mark that we have an execution result - this prevents re-rendering
                hasExecutionResult = true;
                // Save result to restore after re-render
                savedResult = {
                  className: resultDiv.className,
                  innerHTML: resultDiv.innerHTML
                };
              }
              // Execution is complete, set flags
              isExecuting = false;
              const executeButton = document.getElementById('execute-button');
              if (executeButton) executeButton.disabled = false;
            }
            if (msg.type === 'executeProgress' && msg.status === 'done') {
              // Only set isExecuting to false if we haven't already processed the result
              if (!hasExecutionResult) {
                isExecuting = false;
                const executeButton = document.getElementById('execute-button');
                if (executeButton) executeButton.disabled = false;
              }
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}

// Old provider removed - replaced by separate view providers

function maskKey(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function getNonce() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function ensureMcpConfigWithStoredKey(context: vscode.ExtensionContext) {
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

async function ensureMcpConfigWithApiKey(apiKey: string) {
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

function getMcpConfigPaths() {
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

async function writeMcpConfigFile(mcpPath: string, apiKey: string) {
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

async function readApiKeyFromMcpConfigs(): Promise<string | undefined> {
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

async function getStoredEmail(context: vscode.ExtensionContext) {
  const secretEmail = await context.secrets.get(secretKeyName('qverisEmail'));
  if (secretEmail) return secretEmail;
  return context.globalState.get<string>(globalStateKey('qverisEmail'));
}

function isCursorApp() {
  return !!process.env.CURSOR || (vscode.env.appName || '').toLowerCase().includes('cursor');
}

function secretKeyName(base: string) {
  return `${base}.${isCursorApp() ? 'cursor' : 'vscode'}`;
}

function globalStateKey(base: string) {
  return `${base}.${isCursorApp() ? 'cursor' : 'vscode'}`;
}

function getAllKnownMcpPaths() {
  const paths = [path.join(os.homedir(), '.cursor', 'mcp.json')];
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    paths.push(path.join(workspaceFolder.uri.fsPath, '.vscode', 'mcp.json'));
  }
  return Array.from(new Set(paths));
}


async function copyCursorPrompt(context: vscode.ExtensionContext, markCopied: boolean) {
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

async function openCursorPromptDoc() {
  const doc = await vscode.workspace.openTextDocument({
    content: CURSOR_PROMPT,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage('Qveris MCP prompt opened. Save or paste it into a workspace rules file.');
}

async function maybeEnsureCursorPromptInRules(context: vscode.ExtensionContext) {
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

