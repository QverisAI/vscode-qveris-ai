# Qveris AI VS Code / Cursor Extension

Official extension for [Qveris.ai](https://qveris.ai). Sign in once, get your API key securely stored, auto-install the Qveris MCP SDK, and run Qveris tools directly from VS Code or Cursor.

## About Qveris
Qveris 是一个面向开发者的智能工具平台，提供 MCP 服务器与丰富的工具搜索/执行能力，帮助你在编辑器内完成信息查询、自动化操作与工作流编排。

## What the Extension Does
- Sidebar 登录：在侧边栏输入邮箱/密码完成登录。
- 自动获取/创建 API Key：成功后将完整 Key 安全保存在 VS Code Secrets。
- 一键打开官网：按钮直接在默认浏览器打开 qveris.ai。
- 自动安装 MCP SDK：检测不到 `@qverisai/sdk` 时自动执行 `npx @qverisai/sdk` 并验证。
- 自动写入 MCP 配置：把 `QVERIS_API_KEY` 写入 `~/.cursor/mcp.json` 与工作区的 `.vscode/mcp.json`，方便 Cursor / VS Code 使用 Qveris MCP。
- Cursor 规则提示：在 Cursor 工作区自动补充 MCP 提示文本（可配置路径）。

## Requirements
- VS Code 1.85+ 或 Cursor
- Node.js 18+
- 一个 Qveris.ai 账号（邮箱 + 密码）

## How to Use
1) 安装扩展（VSIX 或 Marketplace 上架后直接安装）。  
2) 打开 **Qveris AI** 侧边栏。  
3) 输入邮箱/密码点击 **Sign in**。扩展会：
   - 登录并获取用户信息
   - 列出或创建 API Key，并存入 VS Code Secrets
   - 自动安装/验证 `@qverisai/sdk`
   - 将 API Key 写入 `~/.cursor/mcp.json` 与工作区 `.vscode/mcp.json` 的 `qveris` 配置
4) 登录后可直接使用：复制 Key、打开官网、注销等。

## MCP 配置示例（自动写入）
扩展会在 `~/.cursor/mcp.json` 与当前工作区的 `.vscode/mcp.json` 写入/更新：
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

## Configuration (可选)
- `qverisAi.backendUrl`：API 基础地址，默认 `https://qveris.ai`
- `qverisAi.apiKeyName`：创建新 Key 时的名称前缀，默认 `vscode`
- `qverisAi.cursorRulesPath`：Cursor 规则文件路径，默认 `.cursor/rules/qveris.mdc`
- `qverisAi.cursorUserRule`：写入规则文件的提示文本

## Commands
- `Qveris AI: Open qveris.ai`
- `Qveris AI: Copy API Key`
- `Qveris AI: Refresh Login/API Key`
- `Qveris AI: Copy Cursor Workspace Rule`
- `Qveris AI: Open Cursor Workspace Rule Text`

## Support
- 官网: <https://qveris.ai>
- Issues: <https://github.com/QverisAI/vscode-qveris-ai/issues>

## License
MIT (见 `LICENSE`)

