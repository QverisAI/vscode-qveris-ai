import * as vscode from 'vscode';
import axios from 'axios';
import { ViewStateManager } from './stateManager';
import { getNonce, secretKeyName, globalStateKey, isToolId, generateSearchId } from './utils';
import { log } from './logger';

// Tool Search View Provider
export class ToolSearchViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateManager: ViewStateManager
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    log('Qveris: ToolSearchViewProvider.resolveWebviewView called');
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    
    webviewView.onDidChangeVisibility(() => {
      log('Qveris: ToolSearchView visibility changed, visible: ' + webviewView.visible);
      if (webviewView.visible) {
        // Refresh state when view becomes visible
      }
    });

    log('Qveris: Setting webview HTML');
    webviewView.webview.html = this.getHtml(webviewView.webview);
    log('Qveris: Webview HTML set, registering message handler');

    webviewView.webview.onDidReceiveMessage(async (message) => {
      log('Qveris: Received message from webview, type: ' + (message.type || 'unknown'));
      switch (message.type) {
        case 'search':
          log('Qveris: Processing search message with query: ' + (message.query || 'empty'));
          await this.handleSearch(message.query);
          break;
        case 'selectTool':
          log('Qveris: Processing selectTool message');
          // Broadcast tool selection to Tool Execution view
          await this.broadcastToolSelection(message.tool);
          break;
        default:
          log('Qveris: Unknown message type: ' + (message.type || 'undefined'));
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
    log('Qveris: handleSearch called with query: ' + (query || 'empty'));
    
    if (!this.view) {
      log('Qveris: handleSearch - view is not available');
      return;
    }

    if (!query || !query.trim()) {
      log('Qveris: handleSearch - query is empty');
      this.view.webview.postMessage({
        type: 'searchError',
        message: 'Please enter a search query.'
      });
      return;
    }

    const apiKey = await this.context.secrets.get(secretKeyName('qverisApiKey'));
    if (!apiKey) {
      this.view.webview.postMessage({
        type: 'searchError',
        message: 'Please sign in first to search tools.'
      });
      return;
    }

    // Get session_id from global state
    const sessionId = this.context.globalState.get<string>(globalStateKey('sessionId'));
    if (!sessionId) {
      log('Qveris: session_id not found, this should not happen');
      this.view.webview.postMessage({
        type: 'searchError',
        message: 'Session not initialized. Please reload the extension.'
      });
      return;
    }

    this.view.webview.postMessage({ type: 'searchProgress', status: 'starting' });

    try {
      const config = vscode.workspace.getConfiguration('qverisAi');
      const baseUrl = (config.get<string>('backendUrl') || 'https://qveris.ai').replace(/\/+$/, '');
      const trimmedQuery = query.trim();
      
      let searchResponse;
      let searchId: string;

      // Check if query is a tool_id
      if (isToolId(trimmedQuery)) {
        log('Qveris: Query is a tool_id, calling /tools/by-ids interface');
        const byIdsUrl = `${baseUrl}/api/v1/tools/by-ids`;
        searchId = generateSearchId();
        
        log('Qveris: Calling /tools/by-ids with tool_id: ' + trimmedQuery);
        log('Qveris: By-ids URL: ' + byIdsUrl);
        
        searchResponse = await axios.post(
          byIdsUrl,
          {
            tool_ids: [trimmedQuery],
            session_id: sessionId
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
      } else {
        log('Qveris: Query is not a tool_id, calling /search interface');
        const searchUrl = `${baseUrl}/api/v1/search`;
        searchId = generateSearchId();
        
        log('Qveris: Starting search with query: ' + trimmedQuery);
        log('Qveris: Search URL: ' + searchUrl);
        
        searchResponse = await axios.post(
          searchUrl,
          {
            query: trimmedQuery,
            limit: 10,
            search_id: searchId,
            session_id: sessionId
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
      }

      log('Qveris: Search response status: ' + searchResponse.status);
      log('Qveris: Search response data: ' + JSON.stringify(searchResponse.data, null, 2));

      // HTTP 200 means success, use response data directly
      // Response format: { query: '...', total: 10, results: [...], search_id: '...' }
      const searchData = searchResponse.data;
      
      if (!searchData || !Array.isArray(searchData.results)) {
        const errorMsg = searchResponse.data?.message || 
                       searchResponse.data?.error || 
                       'Invalid search response format';
        log('Qveris: Invalid search response: ' + errorMsg);
        throw new Error(errorMsg);
      }

      // Store search_id from response (or use generated one if not present)
      const responseSearchId = searchData.search_id || searchId;
      if (responseSearchId) {
        // Store the search_id for use in execute interface
        await this.context.globalState.update(globalStateKey('lastSearchId'), responseSearchId);
      }

      // Send success message with search data
      log('Qveris: Sending search success message with ' + searchData.results.length + ' results');
      this.view.webview.postMessage({
        type: 'searchSuccess',
        data: searchData
      });
    } catch (err: any) {
      log('Qveris: Search error occurred');
      log('Qveris: Error type: ' + (err?.constructor?.name || 'unknown'));
      log('Qveris: Error message: ' + (err?.message || 'unknown'));
      
      let message = 'Search failed';
      
      // Handle axios errors with response
      if (err?.response) {
        log('Qveris: Error response status: ' + err.response.status);
        log('Qveris: Error response data: ' + JSON.stringify(err.response.data, null, 2));
        
        // Extract error message from response
        const errorData = err.response.data;
        message = errorData?.message || 
                 errorData?.error || 
                 errorData?.data?.message ||
                 errorData?.detail ||
                 `Request failed with status ${err.response.status}`;
        
        // Handle specific HTTP status codes
        if (err.response.status === 401) {
          message = 'Authentication failed. Please sign in again.';
        } else if (err.response.status === 403) {
          message = 'Access denied. Please check your permissions.';
        } else if (err.response.status === 404) {
          message = 'Search endpoint not found. Please check the backend URL configuration.';
        } else if (err.response.status >= 500) {
          message = 'Server error. Please try again later.';
        }
      } 
      // Handle network errors (no response)
      else if (err?.request) {
        log('Qveris: Network error - request was sent but no response received');
        message = 'Network error. Please check your internet connection.';
      }
      // Handle timeout errors
      else if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
        log('Qveris: Request timeout');
        message = 'Request timeout. Please try again.';
      }
      // Handle other errors
      else if (err?.message) {
        message = err.message;
      }
      
      log('Qveris: Final error message to display: ' + message);
      
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
      body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
      .row { display: flex; gap: 8px; margin-bottom: 8px; }
      input { width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      button { padding: 6px 10px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 4px; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .status { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
      .error { color: #f85149; }
      .tool-item { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 10px; margin-bottom: 8px; background: var(--vscode-list-background, var(--vscode-sideBar-background, var(--vscode-editor-background))); cursor: pointer; position: relative; transition: all 0.2s ease; }
      .tool-item:hover { border-color: var(--vscode-focusBorder); }
      .tool-item.selected { 
        border-color: var(--vscode-focusBorder); 
        border-width: 3px; 
        background: var(--vscode-list-activeSelectionBackground, var(--vscode-editor-selectionBackground));
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .tool-item.selected .tool-item-header { 
        color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); 
      }
      .tool-item.selected .tool-item-description { 
        color: var(--vscode-list-activeSelectionForeground, var(--vscode-descriptionForeground)); 
        opacity: 0.9;
      }
      .tool-item.selected .tool-item-meta { 
        color: var(--vscode-list-activeSelectionForeground, var(--vscode-descriptionForeground)); 
        opacity: 0.8;
      }
      .tool-item.selected .tool-category { 
        color: var(--vscode-list-activeSelectionForeground, var(--vscode-descriptionForeground)); 
        opacity: 0.8;
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
            console.log('Qveris: performSearch called from frontend');
            const query = searchInput?.value?.trim() || '';
            console.log('Qveris: Frontend search query: ' + query);
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
            console.log('Qveris: Frontend sending message: { type: "search", query: "' + query + '" }');
            vscode.postMessage({ type: 'search', query });
            console.log('Qveris: Frontend message sent');
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
              
              // Display tool_id
              if (tool.tool_id || tool.tool) {
                const toolIdSpan = document.createElement('span');
                toolIdSpan.textContent = 'ID: ' + (tool.tool_id || tool.tool);
                toolIdSpan.style.fontFamily = 'monospace';
                toolIdSpan.style.fontSize = '11px';
                meta.appendChild(toolIdSpan);
              }
              
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

