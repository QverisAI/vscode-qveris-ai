import * as vscode from 'vscode';
import { BaseViewProvider } from './baseViewProvider';
import { ViewStateManager } from './stateManager';
import { getNonce } from './utils';

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

