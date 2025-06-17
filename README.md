[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/mihai-dulgheru-mssql-mcp-node-badge.png)](https://mseep.ai/app/mihai-dulgheru-mssql-mcp-node)

# MSSQL Model Context Protocol (MCP) Server

![npm version](https://img.shields.io/npm/v/mssql-mcp-node)
![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

A Node.js implementation of the Model Context Protocol server for Microsoft SQL Server databases. This server provides a standardized API interface to interact with SQL Server databases, exposing database tables as resources and offering tools to execute SQL queries and retrieve schema information.

## Multi-Database Support

This project now features automatic configuration detection that allows it to work in two modes:

1. **Single-database mode** - Uses simple `MSSQL_*` variables to connect to one database
2. **Multi-database mode** - Uses prefixed environment variables (`MSSQL_MAINDB_*`, `MSSQL_REPORTINGDB_*`, etc.) to connect to multiple databases

The server auto-detects which mode is active at runtime and exposes the same REST/MCP interface in either case.

## Environment Configuration

### Single-Database Mode

```ini
# Single database configuration
MSSQL_SERVER=your_sql_server_address
MSSQL_PORT=1433
MSSQL_USER=your_username
MSSQL_PASSWORD=your_password
MSSQL_DATABASE=your_database_name
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=false
```

### Multi-Database Mode

```ini
# Main database
MSSQL_MAINDB_SERVER=your_sql_server_address
MSSQL_MAINDB_PORT=1433
MSSQL_MAINDB_USER=your_username
MSSQL_MAINDB_PASSWORD=your_password
MSSQL_MAINDB_DATABASE=main_db_name
MSSQL_MAINDB_ENCRYPT=true
MSSQL_MAINDB_TRUST_SERVER_CERTIFICATE=false

# Reporting database
MSSQL_REPORTINGDB_SERVER=your_sql_server_address
MSSQL_REPORTINGDB_PORT=1433
MSSQL_REPORTINGDB_USER=your_username
MSSQL_REPORTINGDB_PASSWORD=your_password
MSSQL_REPORTINGDB_DATABASE=reporting_db_name
MSSQL_REPORTINGDB_ENCRYPT=true
MSSQL_REPORTINGDB_TRUST_SERVER_CERTIFICATE=false
```

> **Important:** Configure EITHER the Single-Database OR the Multi-Database variables in your `.env` file - not both. The server detects which mode to use based on the presence of specific variables.

### Configuration and Behavior Matrix

| Launch Config         | Environment Setup         | Behavior                                          |
| --------------------- | ------------------------- | ------------------------------------------------- |
| mssql-mcp-node-single | Single-Database variables | Operates in single-DB mode with one database      |
| mssql-mcp-node-multi  | Multi-Database variables  | Operates in multi-DB mode with multiple databases |

### Default dbKey Behavior

In multi-database mode, when no `dbKey` is specified in the request, the server automatically uses the first database in your configuration (typically `maindb`). This makes API requests more concise while maintaining backward compatibility.

## Features

- **Auto-detect Configuration Mode**: Automatically determines whether to use single or multi-database mode
- **Resource Management**: Access SQL Server tables as resources
- **SQL Query Execution**: Execute SQL queries against the connected database(s)
- **Schema Information**: Retrieve metadata and schema details for database tables
- **MCP Protocol Support**: Communicates via STDIO using the Model Context Protocol SDK
- **HTTP API**: For local testing using Express
- **Enhanced Validation**: Uses Zod for robust input validation with clear error messages
- **Security Features**: Parameterized queries and SQL injection protection

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

   Then, update the `.env` file with your SQL Server connection details using EITHER single-database OR multi-database format (see above sections).

   > **Security Recommendations:**
   >
   > - **Development:**
   >   - `MSSQL_ENCRYPT="false"` or `MSSQL_*DB_ENCRYPT="false"`
   >   - `MSSQL_TRUST_SERVER_CERTIFICATE="true"` or `MSSQL_*DB_TRUST_SERVER_CERTIFICATE="true"`
   > - **Production:**
   >   - `MSSQL_ENCRYPT="true"` or `MSSQL_*DB_ENCRYPT="true"` (to encrypt the connection)
   >   - `MSSQL_TRUST_SERVER_CERTIFICATE="false"` or `MSSQL_*DB_TRUST_SERVER_CERTIFICATE="false"` (to enforce certificate validation)

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
  GET /resources?dbKey=maindb
  ```

  **Example Response:**

  ```json
  [
    {
      "uri": "mssql://YourTable/data",
      "name": "Table: YourTable",
      "description": "Data in table: YourTable (DB: your_database)",
      "mimeType": "text/plain"
    }
  ]
  ```

- **Get Resource Data:**

  ```http
  GET /resource?uri=mssql://YourTable/data&dbKey=maindb
  ```

  **Example Response:**

  ```
  # Database: your_database
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
      "description": "Execute an SQL query on the SQL Server (multi-database support)",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "The SQL query to execute"
          },
          "dbKey": {
            "type": "string",
            "description": "The database key to use (e.g., 'maindb', 'reportingdb', etc.). Optional in single-db mode."
          }
        },
        "required": ["query"]
      }
    },
    {
      "name": "get_table_schema",
      "description": "Retrieve the schema of a specified table (multi-database support)",
      "inputSchema": {
        "type": "object",
        "properties": {
          "table": {
            "type": "string",
            "description": "The name of the table"
          },
          "dbKey": {
            "type": "string",
            "description": "The database key to use (e.g., 'maindb', 'reportingdb', etc.). Optional in single-db mode."
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
    "query": "SELECT TOP 10 * FROM YourTable",
    "dbKey": "maindb" // Optional, defaults to first configured database
  }
  ```

  **Response Example for SELECT queries:**

  ```json
  {
    "db": "your_database",
    "rowCount": 2,
    "recordset": [
      { "id": 1, "name": "Item1", "created_at": "2025-01-01" },
      { "id": 2, "name": "Item2", "created_at": "2025-01-02" }
    ]
  }
  ```

  **Response Example for non-SELECT queries:**

  ```json
  {
    "message": "Query executed successfully",
    "db": "your_database",
    "rowsAffected": 1
  }
  ```

- **Get Table Schema:**

  ```http
  POST /get-table-schema
  ```

  **Request Body:**

  ```json
  {
    "table": "YourTable",
    "dbKey": "reportingdb" // Optional, defaults to first configured database
  }
  ```

  **Response Example:**

  ```json
  {
    "db": "reporting_db_name",
    "table": "YourTable",
    "columns": [
      {
        "COLUMN_NAME": "id",
        "DATA_TYPE": "int",
        "CHARACTER_MAXIMUM_LENGTH": null
      },
      {
        "COLUMN_NAME": "name",
        "DATA_TYPE": "varchar",
        "CHARACTER_MAXIMUM_LENGTH": 100
      },
      {
        "COLUMN_NAME": "created_at",
        "DATA_TYPE": "datetime",
        "CHARACTER_MAXIMUM_LENGTH": null
      }
    ],
    "rowCount": 3
  }
  ```

## Integration with Claude Desktop or VS Code

To integrate this MCP server with Claude Desktop or VS Code, add the following JSON snippet to your MCP configuration file. For Claude Desktop, this is typically in `mcpServers.json`, and for VS Code, in your workspace configuration (`.vscode/mcp.json`).

### VS Code

For VS Code 1.86.0 and newer, use either single or multi-database configuration:

#### Single-Database Configuration

```json
{
  "servers": {
    "mssql-mcp-node-single": {
      "command": "npx",
      "args": ["-y", "mssql-mcp-node"],
      "env": {
        "MSSQL_SERVER": "your_server_name",
        "MSSQL_PORT": "1433",
        "MSSQL_USER": "your_username",
        "MSSQL_PASSWORD": "your_password",
        "MSSQL_DATABASE": "your_database",
        "MSSQL_ENCRYPT": "true",
        "MSSQL_TRUST_SERVER_CERTIFICATE": "false"
      }
    }
  }
}
```

#### Multi-Database Configuration

```json
{
  "servers": {
    "mssql-mcp-node-multi": {
      "command": "npx",
      "args": ["-y", "mssql-mcp-node"],
      "env": {
        "MSSQL_MAINDB_SERVER": "your_server_name",
        "MSSQL_MAINDB_PORT": "1433",
        "MSSQL_MAINDB_USER": "your_username",
        "MSSQL_MAINDB_PASSWORD": "your_password",
        "MSSQL_MAINDB_DATABASE": "main_database",
        "MSSQL_MAINDB_ENCRYPT": "true",
        "MSSQL_MAINDB_TRUST_SERVER_CERTIFICATE": "false",

        "MSSQL_REPORTINGDB_SERVER": "your_server_name",
        "MSSQL_REPORTINGDB_PORT": "1433",
        "MSSQL_REPORTINGDB_USER": "your_username",
        "MSSQL_REPORTINGDB_PASSWORD": "your_password",
        "MSSQL_REPORTINGDB_DATABASE": "reporting_database",
        "MSSQL_REPORTINGDB_ENCRYPT": "true",
        "MSSQL_REPORTINGDB_TRUST_SERVER_CERTIFICATE": "false"
      }
    }
  }
}
```

You can also install this package locally instead of using `npx`:

```bash
npm install --save-dev mssql-mcp-node
```

## MCP Tools

When using the MCP server through the Claude Desktop or VS Code integration, you can use the following tools:

### execute_sql

Execute an SQL query against the connected database(s).

**Input:**

```json
{
  "query": "SELECT TOP 10 * FROM YourTable",
  "dbKey": "maindb" // Optional in both modes, defaults to first available database
}
```

**Example usage in Claude Desktop:**

```
I'd like to see data from the YourTable table in the main database.
```

### get_table_schema

Retrieve the schema information for a specific table.

**Input:**

```json
{
  "table": "YourTable",
  "dbKey": "reportingdb" // Optional in both modes, defaults to first available database
}
```

**Example usage in Claude Desktop:**

```
What columns are in the YourTable table in the reporting database?
```

### list_databases

List all configured databases and their connection information.

**Input:**

```json
{}


// No parameters required
```

**Example usage in Claude Desktop:**

```
Show me all the available databases in the configuration.
```

## Testing

A Postman collection is provided in the `postman/` folder for testing the HTTP endpoints of the Express server. Here are curl examples to test both single and multi-database configurations:

### Testing with curl

Test all four combinations (single/multi-database mode × maindb/reportingdb):

#### Single-Database Mode (with one database only)

```bash
# List Resources
curl -X GET "http://localhost:3000/resources"

# Execute SQL Query
curl -X POST "http://localhost:3000/execute-sql" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT TOP 10 * FROM Users"}'

# Get Table Schema
curl -X POST "http://localhost:3000/get-table-schema" \
  -H "Content-Type: application/json" \
  -d '{"table": "Users"}'
```

#### Multi-Database Mode

```bash
# List Resources from maindb
curl -X GET "http://localhost:3000/resources?dbKey=maindb"

# List Resources from reportingdb
curl -X GET "http://localhost:3000/resources?dbKey=reportingdb"

# Execute SQL Query on maindb
curl -X POST "http://localhost:3000/execute-sql" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT TOP 10 * FROM Users", "dbKey": "maindb"}'

# Execute SQL Query on reportingdb
curl -X POST "http://localhost:3000/execute-sql" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT TOP 10 * FROM SalesReport", "dbKey": "reportingdb"}'
```

## Schema Validation

This project uses [Zod](https://zod.dev/) for schema validation throughout the application to ensure data integrity and provide more robust error handling.

### Implemented Schema Validations

- **SQL Query Validation**: Validates that SQL queries are non-empty strings within a reasonable length limit.
- **Table Name Validation**: Ensures table names follow proper naming conventions (alphanumeric characters and underscores only).
- **Resource URI Validation**: Validates that resource URIs follow the expected format (`mssql://<table_name>/data`).
- **Database Configuration Validation**: Ensures that all required database configuration parameters are provided and properly formatted.
- **Safety Checks**: SQL queries are validated against a list of potentially dangerous operations for additional security.

### Security Enhancements

1. **SQL Injection Protection**: Uses parameterized queries wherever possible.
2. **Query Safety Validation**: Checks for potentially dangerous SQL operations (DROP, TRUNCATE, etc.)
3. **Enhanced Error Messages**: Provides detailed but safe error messages that don't expose sensitive details.
4. **Configuration Validation**: Validates all configuration parameters before attempting to connect.

## Project Structure

```
mssql-mcp-node/
├── .editorconfig
├── .env                  # Environment variables file (not committed)
├── .env.example          # Sample environment configuration (both modes)
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
    │   ├── dbConfig.js    # Database connection handling module
    │   └── index.js       # Configuration auto-detection module
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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Mihai-Nicolae Dulgheru <mihai.dulgheru18@gmail.com>
