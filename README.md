# QVeris AI VS Code/Cursor/Trae/Kiro/Codebuddy/Lingma/Qoder Extension

Official extension for [QVeris.ai](https://qveris.ai). Sign in once, get your API key securely stored, auto-install the QVeris MCP SDK, and use QVeris AI tools directly in your AI chat.

## About QVeris
QVeris is an intelligent tool platform for developers, providing MCP servers with rich tool search/execution capabilities, helping you complete information queries, automation operations, and workflow orchestration within your editor.

## What the Extension Does
- **Sidebar Login**: Securely sign in with your browser to manage your QVeris account.
- **Auto Get/Create API Key**: After successful login, the API key is securely saved in VS Code Secrets.
- **Auto Write MCP Config**: Automatically configures the QVeris MCP server in your IDE (Cursor, Trae, Kiro, etc.), so the AI can use Qveris tools.
- **IDE Rules Integration**: Automatically sets up workspace rules (like `.cursor/rules/qveris.mdc`) to guide the AI on how to use QVeris tools effectively.

## Quick Start
1. **Sign In**: Open the **QVeris AI** sidebar and click **Sign in with Browser**.
2. **Open Chat**: Open your AI chat (e.g., `⌘L` or `Ctrl+L` in Cursor).
3. **Ask & Execute**: Describe what you need, and the AI will use QVeris tools to help you. For example: *"Search for a tool that can get stock prices"* or *"Use QVeris to get real-time crypto prices"*.
4. **Reference Rules**: The extension auto-creates rules (like `@qveris.mdc`). Reference them in your prompt for better tool calling performance.

## Requirements
- VS Code 1.85+, Cursor, Trae, Kiro, Codebuddy, Lingma or Qoder
- Node.js 18+
- A QVeris.ai account

## How to Use
1. Install the extension.
2. Open the **QVeris AI** sidebar.
3. Click **Sign in with Browser**. After successful authentication, the extension will:
   - Securely store your API Key.
   - Configure the QVeris MCP server in your IDE.
   - Install workspace rules to guide the AI.
4. Start chatting with your AI and let it know you want to use QVeris tools!

## MCP Configuration Example (Auto-written)
The extension will write/update MCP configuration files based on your IDE. For Cursor, Kiro, Codebuddy, Lingma, Qoder, and Trae, it uses the `mcpServers` key. For VS Code, it uses the `servers` key.

Example configuration (Cursor/Kiro/Codebuddy/Lingma/Qoder/Trae format):
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

## Configuration (Optional)
- `qverisAi.backendUrl`: API base URL, default `https://qveris.ai`
- `qverisAi.apiKeyName`: Name prefix when creating new Key, default `vscode`
- `qverisAi.cursorRulesPath`: Cursor rules file path, default `.cursor/rules/qveris.mdc`
- `qverisAi.cursorUserRule`: Prompt text written to rules file

## Commands
- `QVeris AI: Sign in with Browser`
- `QVeris AI: Open qveris.ai`
- `QVeris AI: Copy API Key`
- `QVeris AI: Refresh Login/API Key`
- `QVeris AI: Copy Cursor Workspace Rule`
- `QVeris AI: Open Cursor Workspace Rule Text`
- `QVeris AI: Show Debug Logs`

## Support
- Website: <https://qveris.ai>
- Issues: <https://github.com/QverisAI/vscode-qveris-ai/issues>

## Version Updates
When you update to a new version of the extension:
- **Rule files are automatically updated** to ensure you have the latest QVeris AI prompts and configurations
- Your API key remains secure and unchanged
- MCP configuration is preserved

For more details, see [CHANGELOG.md](./CHANGELOG.md)

## License
MIT (see `LICENSE`)
