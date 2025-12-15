import * as vscode from 'vscode';
import axios from 'axios';
import { ViewStateManager } from './stateManager';
import { getNonce, secretKeyName } from './utils';

// Tool Specification View Provider  
export class ToolSpecificationViewProvider implements vscode.WebviewViewProvider {
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

