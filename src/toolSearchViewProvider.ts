import * as vscode from 'vscode';
import axios from 'axios';
import { ViewStateManager } from './stateManager';
import { getNonce, secretKeyName } from './utils';

// Tool Search View Provider
export class ToolSearchViewProvider implements vscode.WebviewViewProvider {
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

