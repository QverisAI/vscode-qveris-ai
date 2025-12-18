export const CURSOR_PROMPT = `
You can use qveris MCP Server to find API tools to help the user. First think about what kind of tools might be useful to accomplish the user's task. Then use the search_tools tool with query describing the capability of the tool, not what params you want to pass to the tool later. Then you should try suitable searched tools using the execute_tool tool, passing parameters to the searched tool through params_to_tool. You could reference the examples given if any for each tool. You may call make multiple search calls in a single response. Once you find the right tool you can code to call that tool use the rest api described below to implement user's requirement:

# Qveris API Documentation

## Authentication

All API requests require authentication via Bearer token in the
\`Authorization\` header.

\`\`\` http
Authorization: Bearer YOUR_API_KEY
\`\`\`

## Base URL

\`\`\` text
https://qveris.ai/api/v1
\`\`\`

## API Endpoints

### 1. Execute Tool

Execute a tool with specified parameters.

#### Endpoint

\`\`\` http
POST /tools/execute?tool_id={tool_id}
\`\`\`

#### Request Body

\`\`\` json
{
  "search_id": "string",
  "session_id": "string",
  "parameters": {
    "city": "London",
    "units": "metric"
  },
  "max_data_size": 20480
}
\`\`\`

#### Response (200 OK)

\`\`\` json
{
  "execution_id": "string",
  "result": {
    "data": {
      "temperature": 15.5,
      "humidity": 72
    }
  },
  "success": true,
  "error_message": null,
  "elapsed_time_ms": 847
}
\`\`\`
`;
