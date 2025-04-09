# MSSQL Model Context Protocol (MCP) Server

A Node.js implementation of the Model Context Protocol server for Microsoft SQL Server databases. This server provides a standardized API interface to interact with SQL Server databases, exposing database tables as resources and offering tools to execute SQL queries and retrieve schema information.

## Features

- **Resource Management**: Access SQL Server tables as resources.
- **SQL Query Execution**: Execute SQL queries against the connected database.
- **Schema Information**: Retrieve metadata and schema details for database tables.
- **MCP Protocol Support**: Communicates via STDIO using the Model Context Protocol SDK.
- **Legacy HTTP API**: For local testing using Express.

## Installation

### Prerequisites

- Node.js (v14 or higher)
- Access to a Microsoft SQL Server database

### Steps

1. **Clone the Repository**

   ```bash
   git clone https://github.com/mihai-dulgheru/mssql-mcp-node.git
   cd mssql-mcp-node
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Configure Environment Variables**

   Copy the example environment configuration and update as needed:

   ```bash
   cp .env.example .env
   ```

   Then, update the `.env` file with your SQL Server connection details. For example:

   ```
   MSSQL_SERVER=your_sql_server_address
   MSSQL_PORT=your_sql_port
   MSSQL_USER=your_username
   MSSQL_PASSWORD=your_password
   MSSQL_DATABASE=your_database_name
   MSSQL_ENCRYPT=false
   MSSQL_TRUST_SERVER_CERTIFICATE=true
   PORT=3000
   ```

   > **Security Recommendations:**
   >
   > - **Development:**
   >   - `MSSQL_ENCRYPT="false"`
   >   - `MSSQL_TRUST_SERVER_CERTIFICATE="true"`
   > - **Production:**
   >   - `MSSQL_ENCRYPT="true"` (to encrypt the connection)
   >   - `MSSQL_TRUST_SERVER_CERTIFICATE="false"` (to enforce certificate validation)

## Usage

There are two modes of operation:

### 1. MCP Mode (STDIO)

This mode uses the Model Context Protocol (MCP) SDK with STDIO transport and is designed for integration with clients like Claude Desktop or VS Code.

- **Start MCP Mode:**

  ```bash
  npm start
  ```

  This runs the MCP server from `src/index.js`.

### 2. Legacy HTTP Mode (Express)

For local testing via HTTP, you can start the legacy Express server that exposes API endpoints.

- **Start Express Mode:**

  ```bash
  npm run start:express
  ```

  This runs the Express server defined in `src/express.js`.

- **Development Mode with Auto-Reload:**

  ```bash
  npm run dev:express
  ```

### API Endpoints (Legacy Express Mode)

- **List Resources (Tables):**

  ```http
  GET /resources
  ```

  **Example Response:**

  ```json
  [
    {
      "uri": "mssql://YourTable/data",
      "name": "Table: YourTable",
      "mimeType": "text/plain",
      "description": "Data in table: YourTable"
    }
  ]
  ```

- **Get Resource Data:**

  ```http
  GET /resource?uri=mssql://YourTable/data
  ```

  **Example Response:**

  ```
  id,name,created_at
  1,Item1,2025-01-01
  2,Item2,2025-01-02
  ```

- **List Available Tools:**

  ```http
  GET /tools
  ```

  **Example Response:**

  ```json
  [
    {
      "name": "execute_sql",
      "description": "Execute an SQL query on the SQL Server",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "The SQL query to execute"
          }
        },
        "required": ["query"]
      }
    },
    {
      "name": "get_table_schema",
      "description": "Retrieve the schema of a specified table",
      "inputSchema": {
        "type": "object",
        "properties": {
          "table": {
            "type": "string",
            "description": "The name of the table"
          }
        },
        "required": ["table"]
      }
    }
  ]
  ```

- **Call a Tool:**

  ```http
  POST /call-tool
  ```

  **Request Body for Executing SQL:**

  ```json
  {
    "name": "execute_sql",
    "arguments": {
      "query": "SELECT TOP 10 * FROM YourTable"
    }
  }
  ```

  **Response Example:**

  ```json
  [
    {
      "type": "text",
      "text": "id,name,created_at\n1,Item1,2025-01-01\n2,Item2,2025-01-02"
    }
  ]
  ```

## Integration with Claude Desktop or VS Code

To integrate this MCP server with Claude Desktop or VS Code, add the following JSON snippet to your MCP configuration file (for example, in `mcpServers.json` or your workspace settings). Replace the placeholder values with your specific environment details:

```json
{
  "servers": {
    "mssql-mcp-node": {
      "command": "npx",
      "args": ["-y", "mssql-mcp-node"],
      "env": {
        "MSSQL_SERVER": "REDACTED_SERVER_ADDRESS",
        "MSSQL_PORT": "REDACTED_PORT",
        "MSSQL_USER": "REDACTED_USER",
        "MSSQL_PASSWORD": "REDACTED_PASSWORD",
        "MSSQL_DATABASE": "REDACTED_DATABASE",
        "MSSQL_ENCRYPT": "false",
        "MSSQL_TRUST_SERVER_CERTIFICATE": "true"
      }
    }
  }
}
```

This configuration will execute the server using:

```bash
npx -y mssql-mcp-node
```

with the specified environment variables injected, so the server connects to your SQL Server instance accordingly.

## Project Structure

```
mssql-mcp-node/
├── .editorconfig
├── .env                  # Environment variables file (not committed)
├── .env.example          # Sample environment configuration
├── .gitignore
├── .markdownlint.json
├── .prettierignore
├── .prettierrc
├── eslint.config.mjs
├── LICENSE
├── node_modules/
├── package-lock.json
├── package.json
├── postman/              # Postman collection for API testing (optional)
├── README.md
└── src/
    ├── config/
    │   └── dbConfig.js    # Database configuration module
    ├── express.js         # Entry point for legacy Express server (HTTP mode)
    ├── index.js           # MCP server entry point (STDIO mode via SDK)
    ├── modules/           # Core modules (resource and tool management)
    │   ├── resources.js   # Functions for listing resources and reading table data
    │   └── tools.js       # Functions for listing and calling tools
    └── server/            # Express server setup (used by express.js)
        └── index.js       # Express server implementation
```

## Testing

A Postman collection is provided in the `postman/` folder (if available) for testing the HTTP endpoints of the legacy Express server. To run the Express server in development mode with auto-reload, use:

```bash
npm run dev:express
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Mihai-Nicolae Dulgheru <mihai.dulgheru18@gmail.com>
