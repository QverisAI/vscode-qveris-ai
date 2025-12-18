import * as vscode from 'vscode';
import { BaseViewProvider } from './baseViewProvider';
import { ViewStateManager } from './stateManager';
import { getNonce, maskKey, secretKeyName } from './utils';

// Home View Provider - Login and user info
export class HomeViewProvider extends BaseViewProvider implements vscode.WebviewViewProvider {
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
        case 'oauthLogin':
          vscode.commands.executeCommand('vscode-qveris-ai.oauthLogin');
          break;
        case 'logout':
          await this.handleLogout(this.context, this.stateManager);
          break;
        case 'loginStateRequest':
          await this.emitStoredState();
          break;
        case 'copyApiKey':
          await vscode.commands.executeCommand('vscode-qveris-ai.copyApiKey');
          break;
      }
    });

    // Subscribe to state changes
    this.stateManager.subscribe(async (email, hasKey) => {
      if (this.view) {
        let maskedKey = '';
        if (hasKey) {
          const apiKey = await this.context.secrets.get(secretKeyName('qverisApiKey'));
          maskedKey = maskKey(apiKey || '');
        }
        this.view.webview.postMessage({
          type: 'loginState',
          email,
          hasKey,
          maskedKey
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
    let maskedKey = '';
    if (state.hasKey) {
      const apiKey = await this.context.secrets.get(secretKeyName('qverisApiKey'));
      maskedKey = maskKey(apiKey || '');
    }
    this.view.webview.postMessage({
      type: 'loginState',
      email: state.email,
      hasKey: state.hasKey,
      maskedKey
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
      .api-key-section { 
        padding: 12px; 
        border-bottom: 1px solid var(--vscode-editorWidget-border); 
        margin-bottom: 12px; 
      }
      .api-key-label { 
        font-size: 12px; 
        color: var(--vscode-descriptionForeground); 
        margin-bottom: 6px; 
      }
      .api-key-display { 
        display: flex; 
        align-items: center; 
        gap: 8px; 
      }
      .api-key-value { 
        font-family: var(--vscode-editor-font-family, monospace); 
        font-size: 12px; 
        color: var(--vscode-foreground); 
        flex: 1; 
        padding: 4px 8px; 
        background: var(--vscode-input-background); 
        border: 1px solid var(--vscode-input-border); 
        border-radius: 4px; 
      }
      .copy-btn { 
        padding: 4px 8px; 
        font-size: 11px; 
        background: var(--vscode-button-secondaryBackground, transparent);
        color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
        border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-button-border));
        cursor: pointer;
        border-radius: 4px;
      }
      .copy-btn:hover { 
        opacity: 0.9; 
      }
      .help-section { 
        margin-top: 12px; 
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
          <div class="api-key-section">
            <div class="api-key-label">API Key</div>
            <div class="api-key-display">
              <div class="api-key-value" id="api-key-value"></div>
              <button class="copy-btn" id="copy-api-key" title="Copy API Key">Copy</button>
            </div>
          </div>
        </div>
        <div id="login-section" class="card">
          <div class="status" id="login-hint">Sign in to Qveris to generate and store your API key.</div>
          <div class="row">
            <button id="oauth-login">Sign in with Browser</button>
          </div>
          <div class="status" id="status"></div>
        </div>
        <div class="help-section">
          <p>You need to sign in to your Qveris account first. If you don't have an account, please visit <a href="https://qveris.ai" target="_blank">qveris.ai</a> to create one. After successful login, the Qveris extension will automatically install the Qveris SDK MCP and configure the API key and Cursor rule for you.</p>
          <p>You can type your requirements in the chat, such as "Help me create a Python test script to get real-time cryptocurrency prices". The Qveris SDK MCP will help you search for suitable tools and generate code to call those tools.</p>
          <p>In the extension sidebar, you can also try searching for Qveris tools directly and execute the tools you find.</p>
        </div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const loginSection = document.getElementById('login-section');
          const loggedSection = document.getElementById('logged-section');
          const userEmail = document.getElementById('user-email');
          const loginHint = document.getElementById('login-hint');
          const status = document.getElementById('status');
          const apiKeyValue = document.getElementById('api-key-value');
          const copyApiKeyBtn = document.getElementById('copy-api-key');

          const showLoggedIn = (email, maskedKey) => {
            if (loginSection) loginSection.style.display = 'none';
            if (loggedSection) loggedSection.style.display = 'block';
            if (userEmail) userEmail.textContent = email || 'Unknown';
            if (apiKeyValue) apiKeyValue.textContent = maskedKey || '';
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

          document.getElementById('oauth-login').addEventListener('click', () => {
            if (status) status.textContent = 'Opening browser for login...';
            vscode.postMessage({ type: 'oauthLogin' });
          });

          document.getElementById('logout').addEventListener('click', () => {
            vscode.postMessage({ type: 'logout' });
          });

          if (copyApiKeyBtn) {
            copyApiKeyBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'copyApiKey' });
            });
          }

          window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'loginState') {
              if (msg.hasKey && msg.email) {
                showLoggedIn(msg.email, msg.maskedKey || '');
                // Save state to webview
                vscode.setState({ loggedIn: true, email: msg.email, maskedKey: msg.maskedKey || '' });
              } else {
                showLoggedOut();
                // Save state to webview
                vscode.setState({ loggedIn: false, email: null, maskedKey: '' });
              }
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
            showLoggedIn(savedState.email, savedState.maskedKey || '');
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

