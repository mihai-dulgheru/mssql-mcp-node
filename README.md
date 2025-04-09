# MSSQL Model Context Protocol (MCP) Server

A Node.js implementation of the Model Context Protocol server for SQL Server databases. This server provides a standardized API interface to interact with SQL Server databases, exposing database tables as resources and offering tools to execute SQL queries and retrieve schema information.

## Features

- **Resource Management**: Access SQL Server tables as resources
- **SQL Execution**: Execute SQL queries against the connected database
- **Schema Information**: Retrieve schema information for database tables
- **RESTful API**: Clean, well-structured API endpoints
- **Environment Configuration**: Easy configuration through environment variables

## Installation

### Prerequisites

- Node.js (v14 or higher)
- Access to a Microsoft SQL Server database

### Steps

1. Clone this repository:

   ```bash
   git clone https://github.com/mihai-dulgheru/mssql-mcp-node.git
   cd mssql-mcp-node
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create environment configuration:

   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your SQL Server connection details:

   ```
   MSSQL_SERVER=your_server_address
   MSSQL_PORT=your_server_port (optional)
   MSSQL_USER=your_username
   MSSQL_PASSWORD=your_password
   MSSQL_DATABASE=your_database_name
   MSSQL_ENCRYPT=true_or_false
   MSSQL_TRUST_SERVER_CERTIFICATE=true_or_false
   PORT=3000 (optional, defaults to 3000)
   ```

## Usage

### Starting the Server

Start the server in development mode with auto-reload:

```bash
npm run dev
```

Start the server in production mode:

```bash
npm start
```

The server will be available at `http://localhost:3000` (or whatever port you specified in the `.env` file).

### API Endpoints

#### List Resources (Tables)

```
GET /resources
```

Returns a list of available tables in the database as resources.

Example response:

```json
[
  {
    "uri": "mssql://TableName/data",
    "name": "Table: TableName",
    "mimeType": "text/plain",
    "description": "Data in table: TableName"
  }
]
```

#### Get Resource Data

```
GET /resource?uri=mssql://TableName/data
```

Returns data from the specified table in CSV format (limited to 100 rows).

Example response:

```
id,name,created_at
1,Item 1,2025-01-01
2,Item 2,2025-01-02
```

#### List Available Tools

```
GET /tools
```

Returns a list of available tools for interacting with the SQL Server.

Example response:

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

#### Call a Tool

```
POST /call-tool
```

Executes a specific tool with the provided arguments.

Request body for `execute_sql`:

```json
{
  "name": "execute_sql",
  "arguments": {
    "query": "SELECT TOP 10 * FROM YourTable"
  }
}
```

Request body for `get_table_schema`:

```json
{
  "name": "get_table_schema",
  "arguments": {
    "table": "YourTable"
  }
}
```

Example response:

```json
[
  {
    "type": "text",
    "text": "id,name,created_at\n1,Item 1,2025-01-01\n2,Item 2,2025-01-02"
  }
]
```

## Development

### Project Structure

```
├── src/
│   ├── config/         # Configuration files
│   ├── modules/        # Core functionality modules
│   ├── server/         # Express server setup
│   └── index.js        # Application entry point
├── postman/            # Postman collection for API testing
├── .env                # Environment variables (not in repo)
└── .env.example        # Example environment configuration
```

### Testing with Postman

A Postman collection is included in the `postman` directory to help with testing the API endpoints. Import this collection into Postman to get started quickly.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Mihai-Nicolae Dulgheru <mihai.dulgheru18@gmail.com>
