# QVeris AI VS Code/Cursor/Trae/Kiro Extension

Official extension for [QVeris.ai](https://qveris.ai). Sign in once, get your API key securely stored, auto-install the QVeris MCP SDK, and run QVeris tools directly from VS Code, Cursor, Trae or Kiro.

## About QVeris
QVeris is an intelligent tool platform for developers, providing MCP servers with rich tool search/execution capabilities, helping you complete information queries, automation operations, and workflow orchestration within your editor.

## What the Extension Does
- **Sidebar Login**: Sign in with email/password in the sidebar.
- **Auto Get/Create API Key**: After successful login, the full API key is securely saved in VS Code Secrets.
- **Auto Write MCP Config**: Writes `QVERIS_API_KEY` to MCP configuration files for easy use with QVeris MCP:
  - Cursor: `~/.cursor/mcp.json`
  - Trae: Platform-specific location (Windows: `%APPDATA%\Trae\User\mcp.json`, macOS: `~/Library/Application Support/Trae/User/mcp.json`, Linux: `~/.trae-server/data/Machine/mcp.json`)
  - Kiro: `~/.kiro/settings/mcp.json`
  - VS Code: Workspace `.vscode/mcp.json`
- **IDE Rules Prompt**: Automatically adds MCP prompt text in IDE-specific rules files:
  - Cursor: `.cursor/rules/qveris.mdc` (workspace)
  - Trae: `.trae/rules/qveris.md` (workspace)
  - Kiro: `~/.kiro/steering/qveris.md` (global)
- **Search And Execute**: Search and run QVeris AI tools directly.

## Requirements
- VS Code 1.85+, Cursor, Trae or Kiro
- Node.js 18+
- A QVeris.ai account (email + password)

## How to Use
1. Install the extension (VSIX or from Marketplace).
2. Open the **QVeris AI** sidebar.
3. Enter email/password and click **Sign in**. The extension will:
   - Login and get user information
   - List or create API Key and store it in VS Code Secrets
   - Automatically install/verify `@qverisai/mcp`
   - Write API Key to IDE-specific MCP configuration files in the `qveris` configuration
   - Automatically create/update IDE-specific rules files with QVeris MCP prompt
4. After login, you can directly use: copy Key, open website, logout, etc.

## MCP Configuration Example (Auto-written)
The extension will write/update MCP configuration files based on your IDE. For Cursor, Kiro, and Trae, it uses the `mcpServers` key. For VS Code, it uses the `servers` key.

Example configuration (Cursor/Kiro/Trae format):
```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

## IDE-Specific Features

### Cursor
- MCP config: `~/.cursor/mcp.json` (uses `mcpServers` key)
- Rules file: `.cursor/rules/qveris.mdc` (workspace, with Cursor-specific header)

### Kiro
- MCP config: `~/.kiro/settings/mcp.json` (uses `mcpServers` key)
- Rules file: `~/.kiro/steering/qveris.md` (global, with Kiro-specific header: `inclusion: always`)
- Browser schema: `kiro://` for OAuth callbacks

### Trae
- MCP config: Platform-specific location (uses `mcpServers` key)
- Rules file: `.trae/rules/qveris.md` (workspace)

### VS Code
- MCP config: Workspace `.vscode/mcp.json` (uses `servers` key)

## Configuration (Optional)
- `qverisAi.backendUrl`: API base URL, default `https://qveris.ai`
- `qverisAi.apiKeyName`: Name prefix when creating new Key, default `vscode`
- `qverisAi.cursorRulesPath`: Cursor rules file path, default `.cursor/rules/qveris.mdc`
- `qverisAi.cursorUserRule`: Prompt text written to rules file

## Commands
- `QVeris AI: Open qveris.ai`
- `QVeris AI: Copy API Key`
- `QVeris AI: Refresh Login/API Key`
- `QVeris AI: Copy Cursor Workspace Rule`
- `QVeris AI: Open Cursor Workspace Rule Text`

## Support
- Website: <https://qveris.ai>
- Issues: <https://github.com/QverisAI/vscode-qveris-ai/issues>

## License
MIT (see `LICENSE`)
