import * as vscode from 'vscode';

export const CURSOR_PROMPT = vscode.workspace.getConfiguration('qverisAi').get<string>('cursorUserRule') ||
  'You can use qveris MCP Server to dynamically search and execute tools to help the user. First think about what kind of tools might be useful to accomplish the user\'s task. Then use the search_tools tool with query describing the capability of the tool, not what params you want to pass to the tool later. Then call a suitable searched tool using the execute_tool tool, passing parameters to the searched tool through params_to_tool. You could reference the examples given if any for each tool. You may call make multiple tool calls in a single response.';

