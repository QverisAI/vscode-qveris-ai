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
        case 'openWebsite':
          await vscode.commands.executeCommand('vscode-qveris-ai.openWebsite');
          break;
        case 'tryExample':
          await vscode.commands.executeCommand('vscode-qveris-ai.tryExample');
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
          // Collapse the view when logged in
          this.view.show(false);
        } else {
          // Expand the view when logged out
          this.view.show(true);
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
    // Get the logo image URI
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'qveris.png')
    );
    // Get the demo image URIs
    const demo1Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'demo1.png')
    );
    const demo2Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'demo2.png')
    );
    const styles = `
      :root { 
        color-scheme: light dark; 
      }
      
      * {
        box-sizing: border-box;
      }
      
      body { 
        font-family: var(--vscode-font-family); 
        padding: 0;
        margin: 0;
        color: var(--vscode-foreground); 
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        line-height: 1.5;
      }
      
      .container {
        padding: 20px;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      
      /* Welcome Card - Logged Out State */
      .welcome-card {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 16px;
        padding: 32px 24px;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
      }

      .logo-title-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 8px;
      }

      .logo-container {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .logo-container img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      
      .welcome-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      
      .welcome-title {
        font-size: 22px;
        font-weight: 700;
        margin: 0;
        color: var(--vscode-foreground);
        letter-spacing: -0.5px;
      }
      
      .welcome-subtitle {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        margin: 0;
        line-height: 1.6;
        max-width: 240px;
      }
      
      .login-button {
        width: 100%;
        padding: 12px 24px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-top: 8px;
      }
      
      .login-button:hover {
        background: var(--vscode-button-hoverBackground);
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }
      
      .login-button:active {
        transform: translateY(0);
      }
      
      .status {
        width: 100%;
        font-size: 12px;
        padding: 10px;
        border-radius: 8px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        text-align: left;
      }
      
      .status.error {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-errorForeground);
        background: rgba(248, 81, 73, 0.05);
      }
      
      /* User Profile Card - Logged In State */
      .profile-card {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      }
      
      .profile-header {
        background: var(--vscode-list-hoverBackground);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--vscode-divider);
      }
      
      .user-info-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .user-label {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.8px;
        font-weight: 700;
      }
      
      .user-email {
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
        word-break: break-all;
      }
      
      .logout-btn {
        background: transparent;
        border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
        cursor: pointer;
        padding: 6px 12px;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        border-radius: 6px;
        font-weight: 500;
        transition: all 0.2s ease;
      }
      
      .logout-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
        color: var(--vscode-foreground);
        border-color: var(--vscode-foreground);
      }
      
      .api-key-section {
        padding: 20px 24px;
      }
      
      .api-key-label {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        font-weight: 700;
      }
      
      .api-key-display {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .api-key-value {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        color: var(--vscode-foreground);
        flex: 1;
        padding: 8px 12px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        opacity: 0.8;
      }
      
      .copy-btn {
        padding: 8px 14px;
        font-size: 12px;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-button-secondaryBorder);
        cursor: pointer;
        border-radius: 8px;
        font-weight: 600;
        transition: all 0.2s ease;
      }
      
      .copy-btn:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      
      /* Quick Start Section */
      .quick-start {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      
      .section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--vscode-foreground);
        text-transform: uppercase;
        letter-spacing: 1px;
        margin: 0;
        padding-left: 4px;
        border-left: 3px solid var(--vscode-button-background);
      }
      
      .step-card {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 12px;
        padding: 16px;
        display: flex;
        gap: 16px;
        transition: all 0.2s ease;
      }

      .step-card:hover {
        border-color: var(--vscode-focusBorder);
        background: var(--vscode-list-hoverBackground);
      }
      
      .step-number {
        width: 24px;
        height: 24px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
      }
      
      .step-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      
      .step-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }
      
      .step-desc {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
      }

      .code-tag {
        font-family: var(--vscode-editor-font-family, monospace);
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        color: var(--vscode-textLink-foreground);
      }

      /* Demo Images */
      .demo-section {
        margin-top: 24px;
        display: flex;
        gap: 16px;
      }

      .demo-section:first-child {
        margin-top: 0;
      }

      .demo-section-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .demo-section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .demo-image-container {
        margin-top: 12px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-editor-background);
      }

      .demo-image {
        width: 100%;
        height: auto;
        display: block;
      }

      /* Try Example Button */
      .try-example-container {
        margin-top: 20px;
        display: flex;
        justify-content: center;
      }

      .try-example-btn {
        width: 100%;
        padding: 12px 24px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .try-example-btn:hover {
        background: var(--vscode-button-hoverBackground);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .try-example-btn:active {
        transform: translateY(0);
      }
      
      /* Animations */
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .welcome-card, .profile-card, .step-card {
        animation: slideIn 0.3s ease-out forwards;
      }

      .step-card:nth-child(2) { animation-delay: 0.1s; }
      .step-card:nth-child(3) { animation-delay: 0.2s; }

      /* Footer Section */
      .footer-section {
        margin-top: 24px;
        padding: 20px 16px;
        text-align: center;
        border-top: 1px solid var(--vscode-editorWidget-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .footer-text {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-weight: 600;
      }

      .website-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 24px;
        background: transparent;
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1.5px solid var(--vscode-textLink-foreground);
        cursor: pointer;
        position: relative;
        overflow: hidden;
      }

      .website-link::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: var(--vscode-textLink-foreground);
        opacity: 0.1;
        transition: left 0.3s ease;
      }

      .website-link:hover::before {
        left: 0;
      }

      .website-link:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        border-color: var(--vscode-textLink-activeForeground);
        color: var(--vscode-textLink-activeForeground);
      }

      .website-link:active {
        transform: translateY(0);
      }
    `;

    return /* html */`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src https: http:; img-src ${webview.cspSource} https: data:;" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>${styles}</style>
      </head>
      <body>
        <div class="container">
          <!-- Logged Out State -->
          <div id="login-section" class="welcome-card">
            <div class="logo-title-container">
              <div class="logo-container">
                <img src="${logoUri}" alt="QVeris Logo" />
              </div>
              <h2 class="welcome-title">QVeris</h2>
            </div>
            <div class="welcome-header">
              <p class="welcome-subtitle">AI-powered tools to supercharge your development workflow.</p>
            </div>
            <button id="oauth-login" class="login-button">
              <span>Sign in with Browser</span>
            </button>
            <div class="status" id="status" style="display:none;"></div>
          </div>

          <!-- Logged In State -->
          <div id="logged-section" style="display:none;">
            <div class="profile-card">
              <div class="profile-header">
                <div class="user-info-group">
                  <div class="user-label">Account</div>
                  <div class="user-email" id="user-email"></div>
                </div>
                <button class="logout-btn" id="logout">Sign Out</button>
              </div>
              <div class="api-key-section">
                <div class="api-key-label">API Key</div>
                <div class="api-key-display">
                  <div class="api-key-value" id="api-key-value"></div>
                  <button class="copy-btn" id="copy-api-key">Copy</button>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Quick Start Section -->
          <div class="quick-start">
            <h3 class="section-title">Quick Start</h3>
            
            <div class="step-card">
              <div class="step-content">
                <div class="demo-section">
                  <div class="step-number">1</div>
                  <div class="demo-section-content">
                    <div class="demo-section-title">Ask in Chat</div>
                    <div class="step-desc">
                      Open Chat (<span class="code-tag">⌘L</span> / <span class="code-tag">Ctrl+L</span>) and describe what you need. Reference <span class="code-tag">@qveris.mdc</span> in your prompt to give the AI context about available tools and APIs.
                    </div>
                    <div class="demo-image-container">
                      <img src="${demo1Uri}" alt="Ask in Chat Demo" class="demo-image" />
                    </div>
                  </div>
                </div>

                <div class="demo-section">
                  <div class="step-number">2</div>
                  <div class="demo-section-content">
                    <div class="demo-section-title">Execute Tools</div>
                    <div class="step-desc">
                      QVeris will find the best tools for you.
                    </div>
                    <div class="demo-image-container">
                      <img src="${demo2Uri}" alt="Execute Tools Demo" class="demo-image" />
                    </div>
                  </div>
                </div>

                <div class="try-example-container">
                  <button class="try-example-btn" id="try-example-btn">
                    <span>✨ Try Example Prompt</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer Section -->
          <div class="footer-section">
            <div class="footer-text">Learn more about QVeris</div>
            <a href="https://qveris.ai" class="website-link" id="website-link" title="Visit QVeris.ai">
              🌐 qveris.ai
            </a>
          </div>
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
            if (loginHint) loginHint.style.display = 'block';
            if (status) {
              status.textContent = '';
              status.className = 'status';
              status.style.display = 'none';
            }
          };

          const showLoggedOut = () => {
            if (loginSection) loginSection.style.display = 'block';
            if (loggedSection) loggedSection.style.display = 'none';
            if (loginHint) loginHint.style.display = 'block';
            if (status) {
              status.textContent = '';
              status.className = 'status';
              status.style.display = 'none';
            }
          };

          document.getElementById('oauth-login').addEventListener('click', () => {
            if (status) {
              status.textContent = 'Opening browser for login...';
              status.className = 'status';
              status.style.display = 'block';
            }
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

          // Website link handler
          const websiteLink = document.getElementById('website-link');
          if (websiteLink) {
            websiteLink.addEventListener('click', (e) => {
              e.preventDefault();
              vscode.postMessage({ type: 'openWebsite' });
            });
          }

          // Try example button handler
          const tryExampleBtn = document.getElementById('try-example-btn');
          if (tryExampleBtn) {
            tryExampleBtn.addEventListener('click', () => {
              vscode.postMessage({ type: 'tryExample' });
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
                status.style.display = 'block';
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

