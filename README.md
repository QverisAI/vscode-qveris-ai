# Qveris AI VS Code / Cursor Extension

Official extension for [Qveris.ai](https://qveris.ai). Sign in once, get your API key securely stored, auto-install the Qveris MCP SDK, and run Qveris tools directly from VS Code or Cursor.

## About Qveris
Qveris is an intelligent tool platform for developers, providing MCP servers with rich tool search/execution capabilities, helping you complete information queries, automation operations, and workflow orchestration within your editor.

## What the Extension Does
- **Sidebar Login**: Sign in with email/password in the sidebar.
- **Auto Get/Create API Key**: After successful login, the full API key is securely saved in VS Code Secrets.
- **One-Click Open Website**: Button opens qveris.ai in your default browser.
- **Auto Install MCP SDK**: Automatically executes `npx @qverisai/sdk` and verifies when `@qverisai/sdk` is not detected.
- **Auto Write MCP Config**: Writes `QVERIS_API_KEY` to `~/.cursor/mcp.json` and workspace `.vscode/mcp.json` for easy use with Cursor / VS Code Qveris MCP.
- **Cursor Rules Prompt**: Automatically adds MCP prompt text in Cursor workspace (configurable path).

## Requirements
- VS Code 1.85+ or Cursor
- Node.js 18+
- A Qveris.ai account (email + password)

## How to Use
1. Install the extension (VSIX or from Marketplace).
2. Open the **Qveris AI** sidebar.
3. Enter email/password and click **Sign in**. The extension will:
   - Login and get user information
   - List or create API Key and store it in VS Code Secrets
   - Automatically install/verify `@qverisai/sdk`
   - Write API Key to `~/.cursor/mcp.json` and workspace `.vscode/mcp.json` in the `qveris` configuration
4. After login, you can directly use: copy Key, open website, logout, etc.

## MCP Configuration Example (Auto-written)
The extension will write/update in `~/.cursor/mcp.json` and current workspace `.vscode/mcp.json`:
```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["@qverisai/sdk"],
      "env": {
        "QVERIS_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

## Configuration (Optional)
- `qverisAi.backendUrl`: API base URL, default `https://qveris.ai`
- `qverisAi.apiKeyName`: Name prefix when creating new Key, default `vscode`
- `qverisAi.cursorRulesPath`: Cursor rules file path, default `.cursor/rules/qveris.mdc`
- `qverisAi.cursorUserRule`: Prompt text written to rules file

## Commands
- `Qveris AI: Open qveris.ai`
- `Qveris AI: Copy API Key`
- `Qveris AI: Refresh Login/API Key`
- `Qveris AI: Copy Cursor Workspace Rule`
- `Qveris AI: Open Cursor Workspace Rule Text`

## Support
- Website: <https://qveris.ai>
- Issues: <https://github.com/QverisAI/vscode-qveris-ai/issues>

## License
MIT (see `LICENSE`)
