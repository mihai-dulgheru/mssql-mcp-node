# MSSQL Model Context Protocol (MCP) Server

A Node.js implementation of the Model Context Protocol server for Microsoft SQL Server databases. This server provides a standardized API interface to interact with SQL Server databases, exposing database tables as resources and offering tools to execute SQL queries and retrieve schema information.

## Features

- **Resource Management**: Access SQL Server tables as resources.
- **SQL Query Execution**: Execute SQL queries against the connected database.
- **Schema Information**: Retrieve metadata and schema details for database tables.
- **MCP Protocol Support**: Communicates via STDIO using the Model Context Protocol SDK.
- **HTTP API**: For local testing using Express.
- **Schema Validation**: Uses Zod for robust input validation across all operations.

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

### 2. HTTP Mode (Express)

For local testing via HTTP, you can start the Express server that exposes API endpoints.

- **Start Express Mode:**

  ```bash
  npm run start:express
  ```

  This runs the Express server defined in `src/express.js`.

- **Development Mode with Auto-Reload:**

  ```bash
  npm run dev:express
  ```

### API Endpoints (Express Mode)

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

- **Execute SQL Query:**

  ```http
  POST /execute-sql
  ```

  **Request Body:**

  ```json
  {
    "query": "SELECT TOP 10 * FROM YourTable"
  }
  ```

  **Response Example for SELECT queries:**

  ```json
  [
    {
      "type": "text",
      "text": "id,name,created_at\n1,Item1,2025-01-01\n2,Item2,2025-01-02"
    }
  ]
  ```

  **Response Example for non-SELECT queries:**

  ```json
  [
    {
      "type": "text",
      "text": "Query executed successfully. Rows affected: 1"
    }
  ]
  ```

- **Get Table Schema:**

  ```http
  POST /get-table-schema
  ```

  **Request Body:**

  ```json
  {
    "table": "YourTable"
  }
  ```

  **Response Example:**

  ```json
  [
    {
      "type": "text",
      "text": "COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH\nid,int,\nname,varchar,100\ncreated_at,datetime,"
    }
  ]
  ```

## Integration with Claude Desktop or VS Code

To integrate this MCP server with Claude Desktop or VS Code, add the following JSON snippet to your MCP configuration file. For Claude Desktop, this is typically in `mcpServers.json`, and for VS Code, in your workspace configuration (`.vscode/mcp.json`):

### Claude Desktop

```json
{
  "mcpServers": {
    "mssql-mcp-node": {
      "command": "npx",
      "args": ["-y", "mssql-mcp-node"],
      "env": {
        "MSSQL_SERVER": "your_server_name",
        "MSSQL_PORT": "1433",
        "MSSQL_USER": "your_username",
        "MSSQL_PASSWORD": "your_password",
        "MSSQL_DATABASE": "your_database",
        "MSSQL_ENCRYPT": "false",
        "MSSQL_TRUST_SERVER_CERTIFICATE": "true"
      }
    }
  }
}
```

### VS Code

For VS Code 1.86.0 and newer:

```json
{
  "modelContextProtocolSupport.servers": {
    "mssql-mcp-node": {
      "command": "npx",
      "args": ["-y", "mssql-mcp-node"],
      "env": {
        "MSSQL_SERVER": "your_server_name",
        "MSSQL_PORT": "1433",
        "MSSQL_USER": "your_username",
        "MSSQL_PASSWORD": "your_password",
        "MSSQL_DATABASE": "your_database",
        "MSSQL_ENCRYPT": "false",
        "MSSQL_TRUST_SERVER_CERTIFICATE": "true"
      }
    }
  }
}
```

You can also install this package locally instead of using `npx`:

```bash
npm install --save-dev mssql-mcp-node
```

And then update your configuration:

```json
{
  "modelContextProtocolSupport.servers": {
    "mssql-mcp-node": {
      "command": "node",
      "args": ["./node_modules/.bin/mssql-mcp-node"],
      "env": {
        // environment variables as above
      }
    }
  }
}
```

This configuration will start the MCP server when needed, injecting your environment variables so it can connect to your SQL Server instance. For production use, consider enabling encryption:

```json
"MSSQL_ENCRYPT": "true",
"MSSQL_TRUST_SERVER_CERTIFICATE": "false"
```

## MCP Tools

When using the MCP server through the Claude Desktop or VS Code integration, you can use the following tools:

### execute_sql

Execute an SQL query against the connected database.

**Input:**

```json
{
  "query": "SELECT TOP 10 * FROM YourTable"
}
```

**Example usage in Claude Desktop:**

```
I'd like to see data from the YourTable table.
```

### get_table_schema

Retrieve the schema information for a specific table.

**Input:**

```json
{
  "table": "YourTable"
}
```

**Example usage in Claude Desktop:**

```
What columns are in the YourTable table?
```

## Schema Validation

This project uses [Zod](https://zod.dev/) for schema validation throughout the application to ensure data integrity and provide more robust error handling.

### Implemented Schema Validations

- **SQL Query Validation**: Validates that SQL queries are non-empty strings within a reasonable length limit.
- **Table Name Validation**: Ensures table names follow proper naming conventions (alphanumeric characters and underscores only).
- **Resource URI Validation**: Validates that resource URIs follow the expected format (`mssql://<table_name>/data`).
- **Database Configuration Validation**: Ensures that all required database configuration parameters are provided and properly formatted.

### Validation Module

The validation module (`src/validation/index.js`) provides a centralized place for all schema definitions and a reusable validation function that handles error formatting and message generation.

### Benefits of Zod Validation

1. **Early Error Detection**: Catches input errors before they reach the database, preventing potential SQL errors.
2. **Better Error Messages**: Provides meaningful error messages that clearly explain validation failures.
3. **Type Safety**: Ensures data conforms to expected types and formats.
4. **Security**: Helps prevent potential injection attacks by validating inputs before use.

### Example Validation Flow

When a user executes an SQL query:

1. The input is validated against the `sqlQuerySchema` schema
2. If validation passes, the query is executed against the database
3. If validation fails, a formatted error message is returned to the client

This validation flow applies to all input data throughout the application, including database configuration, table names, and resource URIs.

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
├── postman/              # Postman collection for API testing
├── README.md
└── src/
    ├── config/
    │   └── dbConfig.js    # Database configuration module
    ├── express.js         # Entry point for Express server (HTTP mode)
    ├── index.js           # MCP server entry point (STDIO mode via SDK)
    ├── modules/           # Core modules (resource and tool management)
    │   ├── resources.js   # Functions for listing resources and reading table data
    │   └── tools.js       # Functions for SQL operations
    ├── server/            # Express server setup (used by express.js)
    │   └── index.js       # Express server implementation
    └── validation/        # Schema validation module using Zod
        └── index.js       # Schema definitions and validation functions
```

## Testing

A Postman collection is provided in the `postman/` folder for testing the HTTP endpoints of the Express server. To run the Express server in development mode with auto-reload, use:

```bash
npm run dev:express
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Mihai-Nicolae Dulgheru <mihai.dulgheru18@gmail.com>
