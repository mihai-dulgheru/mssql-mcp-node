# MSSQL Model Context Protocol (MCP) Server

![npm version](https://img.shields.io/npm/v/mssql-mcp-node)
![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

A Node.js implementation of the Model Context Protocol server for Microsoft SQL Server. Exposes a configured database (or set of databases) to an MCP client via 11 introspection and query tools, table resources, and guided prompts - over either stdio or Streamable HTTP.

## Quick start

```bash
npm install
cp .env.example .env   # then edit credentials
npm start              # stdio transport (Claude Desktop, VS Code, etc.)
npm run start:http     # Streamable HTTP transport on :3000 (POST /mcp)
```

By default the server is read-only. Set `MSSQL_ENABLE_WRITES=true` to opt into `execute_write_query`.

## Breaking changes from 2.x

| 2.x                                      | 3.x                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `execute_sql` (regex-based safety check) | `execute_read_query` + `execute_write_query` (gated by `MSSQL_ENABLE_WRITES`)                                                           |
| `get_table_schema`                       | `describe_table`                                                                                                                        |
| `list_databases`                         | `list_databases` (richer output + pool status)                                                                                          |
| Bespoke REST API in `src/express.js`     | MCP Streamable HTTP transport at `POST /mcp`                                                                                            |
| New `ConnectionPool` per call            | Per-`dbKey` pool, cached and reused                                                                                                     |
| `get_table_schema` only                  | + `list_tables`, `list_views`, `list_indexes`, `list_foreign_keys`, `list_stored_procedures`, `describe_database`, `describe_procedure` |
| -                                        | Prompts: `explore_database`, `summarize_table`                                                                                          |

## Multi-Database Support

Two modes; the server auto-detects from the environment:

1. **Single-database** - `MSSQL_*` variables, exposed as `dbKey="maindb"`
2. **Multi-database** - `MSSQL_<NAME>_*` variables, one config per `<NAME>` (lowercased)

### Single-database mode

```ini
MSSQL_SERVER=your_sql_server_address
MSSQL_PORT=1433
MSSQL_USER=your_username
MSSQL_PASSWORD=your_password
MSSQL_DATABASE=your_database_name
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=false
```

### Multi-database mode

```ini
MSSQL_MAINDB_SERVER=...
MSSQL_MAINDB_USER=...
MSSQL_MAINDB_PASSWORD=...
MSSQL_MAINDB_DATABASE=main_db_name
MSSQL_MAINDB_ENCRYPT=true
MSSQL_MAINDB_TRUST_SERVER_CERTIFICATE=false

MSSQL_REPORTINGDB_SERVER=...
MSSQL_REPORTINGDB_USER=...
MSSQL_REPORTINGDB_PASSWORD=...
MSSQL_REPORTINGDB_DATABASE=reporting_db_name
MSSQL_REPORTINGDB_ENCRYPT=true
MSSQL_REPORTINGDB_TRUST_SERVER_CERTIFICATE=false
```

Custom names work the same way - `MSSQL_ANALYTICS_*` exposes `dbKey="analytics"`, etc. Per-database credentials fall back to the global `MSSQL_USER` / `MSSQL_PASSWORD` / `MSSQL_SERVER` if omitted.

> Configure **either** single-database **or** multi-database variables, not both. If any `MSSQL_<NAME>_DATABASE` is present, multi-db wins.

### Write opt-in

```ini
MSSQL_ENABLE_WRITES=true   # enables execute_write_query; defaults to false
```

When disabled, `execute_write_query` returns an error before any connection attempt. `execute_read_query` always runs inside a transaction that is rolled back regardless of outcome, so accidental writes inside a "read" query are non-durable.

For real safety, also give the configured DB user only the grants you intend it to have - least privilege is the source of truth, not the tool split.

## Environment variables

Consolidated reference. All 2.x variables still work identically - the only additions in 3.x are `MSSQL_ENABLE_WRITES` and the `MSSQL_TEST_*` family (integration-script only, never read by the server).

### Database connection (used by the MCP server)

| Variable                                | Mode   | Required     | Default       | Notes                                                                                                         |
| --------------------------------------- | ------ | ------------ | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `MSSQL_SERVER`                          | single | yes          | `localhost`   | Hostname or IP.                                                                                               |
| `MSSQL_PORT`                            | single | no           | mssql default | Coerced to integer.                                                                                           |
| `MSSQL_USER`                            | single | yes          | -             | Login name.                                                                                                   |
| `MSSQL_PASSWORD`                        | single | yes          | -             | -                                                                                                             |
| `MSSQL_DATABASE`                        | single | yes          | -             | Exposed as `dbKey="maindb"`.                                                                                  |
| `MSSQL_ENCRYPT`                         | single | no           | `false`       | Set `true` to encrypt the connection.                                                                         |
| `MSSQL_TRUST_SERVER_CERTIFICATE`        | single | no           | `true`        | Set `false` to enforce certificate validation.                                                                |
| `MSSQL_<NAME>_SERVER`                   | multi  | no           | global        | Falls back to `MSSQL_SERVER` if omitted.                                                                      |
| `MSSQL_<NAME>_PORT`                     | multi  | no           | mssql default | -                                                                                                             |
| `MSSQL_<NAME>_USER`                     | multi  | no           | global        | Falls back to `MSSQL_USER`.                                                                                   |
| `MSSQL_<NAME>_PASSWORD`                 | multi  | no           | global        | Falls back to `MSSQL_PASSWORD`.                                                                               |
| `MSSQL_<NAME>_DATABASE`                 | multi  | yes (per DB) | -             | Presence of any `_DATABASE` switches the server into multi-db mode. Exposed as `dbKey="<name>"` (lowercased). |
| `MSSQL_<NAME>_ENCRYPT`                  | multi  | no           | `false`       | -                                                                                                             |
| `MSSQL_<NAME>_TRUST_SERVER_CERTIFICATE` | multi  | no           | `true`        | -                                                                                                             |

### Server behavior

| Variable              | Required | Default | Effect                                                                                                                        |
| --------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `MSSQL_ENABLE_WRITES` | no       | `false` | When `true`, `execute_write_query` is allowed to run. With it unset/false, the tool errors out before any connection attempt. |
| `PORT`                | no       | `3000`  | HTTP transport only (`npm run start:http`). Ignored in stdio mode.                                                            |

### Integration script (`scripts/integration.js`, never read by the server)

| Variable              | Required | Default     | Notes                                          |
| --------------------- | -------- | ----------- | ---------------------------------------------- |
| `MSSQL_TEST_SERVER`   | no       | `localhost` | Target SQL Server (Docker, LocalDB, anywhere). |
| `MSSQL_TEST_PORT`     | no       | `1433`      | -                                              |
| `MSSQL_TEST_USER`     | no       | `sa`        | -                                              |
| `MSSQL_TEST_PASSWORD` | yes      | -           | The script exits 2 without it.                 |

> **Single vs multi:** configure **either** the bare `MSSQL_*` variables **or** the prefixed `MSSQL_<NAME>_*` variables - not both. If any `MSSQL_<NAME>_DATABASE` is present, multi-db mode wins. Your existing 2.x `.env` continues to work unchanged.

## Transports

### Stdio (default for MCP clients)

```bash
npm start
```

Runs `src/index.js`. Use this from Claude Desktop, VS Code MCP, or any client that spawns the server as a subprocess.

### Streamable HTTP

```bash
npm run start:http       # listens on $PORT (default 3000)
```

Endpoint: `POST /mcp` (JSON-RPC 2.0). The server runs in **stateless** mode - every POST gets its own server instance - which is easier to scale and matches the SDK's recommended default. `GET /mcp` and `DELETE /mcp` return 405 (no SSE streams in stateless mode).

`GET /healthz` returns `{ ok: true }` for liveness checks.

#### Smoke test

```bash
curl -sS -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tool catalog

All tools accept an optional `dbKey`. In single-database mode the default is `maindb`; in multi-database mode it's the first key loaded.

Every tool returns both human-readable `content` (JSON text) and parsed `structuredContent` (the same payload as a typed object).

### Query tools

| Tool                  | Annotations          | Notes                                                                                                                                           |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute_read_query`  | readOnly, idempotent | Streamed, rollback-only. Server cancels after `offset + limit` rows. Inputs: `query`, optional `dbKey`, `limit` (≤1000, default 100), `offset`. |
| `execute_write_query` | destructive          | Requires `MSSQL_ENABLE_WRITES=true`. Inputs: `query`, optional `dbKey`.                                                                         |

### Catalog (paginated)

| Tool                     | Inputs                              |
| ------------------------ | ----------------------------------- |
| `list_databases`         | -                                   |
| `describe_database`      | optional `dbKey`                    |
| `list_tables`            | optional `dbKey`, `limit`, `offset` |
| `list_views`             | optional `dbKey`, `limit`, `offset` |
| `list_stored_procedures` | optional `dbKey`, `limit`, `offset` |

### Per-object inspection

| Tool                 | Inputs                                             |
| -------------------- | -------------------------------------------------- |
| `describe_table`     | `table` (bare or `schema.table`), optional `dbKey` |
| `describe_procedure` | `procedure`, optional `dbKey`                      |
| `list_indexes`       | `table`, optional `dbKey`                          |
| `list_foreign_keys`  | optional `table` (whole-DB if omitted), `dbKey`    |

### Example: `execute_read_query`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "execute_read_query",
    "arguments": {
      "query": "SELECT TOP 5 * FROM dbo.Users",
      "dbKey": "maindb",
      "limit": 5
    }
  }
}
```

Result `structuredContent`:

```json
{
  "db": "your_database",
  "dbKey": "maindb",
  "rowCount": 5,
  "totalRowsReturnedByQuery": 5,
  "truncated": false,
  "recordset": [{ "id": 1, "name": "Item1", "created_at": "2025-01-01" }]
}
```

## Resources

The server exposes one resource template:

```
mssql://<dbKey>@<schema>.<table>/data
```

Reading the resource returns the first 100 rows as CSV with a leading `# Database: <name>` comment. `resources/list` enumerates every base table across every configured `dbKey` (capped at 500 tables per DB to bound the response).

## Prompts

| Prompt             | Args                      | Purpose                                                      |
| ------------------ | ------------------------- | ------------------------------------------------------------ |
| `explore_database` | optional `dbKey`          | Step-by-step instructions for surveying an unknown database. |
| `summarize_table`  | `table`, optional `dbKey` | Produces a column/index/FK/sample-rows brief on one table.   |

## Integration with Claude Desktop or VS Code

The package ships an `mssql-mcp-node` bin, so you can invoke it via `npx`.

### Single-database

```json
{
  "servers": {
    "mssql-mcp-node": {
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

### Multi-database

```json
{
  "servers": {
    "mssql-mcp-node": {
      "command": "npx",
      "args": ["-y", "mssql-mcp-node"],
      "env": {
        "MSSQL_MAINDB_SERVER": "your_server_name",
        "MSSQL_MAINDB_USER": "your_username",
        "MSSQL_MAINDB_PASSWORD": "your_password",
        "MSSQL_MAINDB_DATABASE": "main_database",
        "MSSQL_MAINDB_ENCRYPT": "true",
        "MSSQL_MAINDB_TRUST_SERVER_CERTIFICATE": "false",

        "MSSQL_REPORTINGDB_SERVER": "your_server_name",
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

To enable writes, also add `"MSSQL_ENABLE_WRITES": "true"`. Use a dedicated SQL login with the minimum grants the workload needs.

## Architecture

```
src/
├── index.js              # stdio entry
├── http.js               # Streamable HTTP entry
├── server.js             # McpServer factory
├── config.js             # env -> validated connection configs
├── validation.js         # shared Zod shapes
├── resources.js          # ResourceTemplate registration
├── prompts.js            # MCP prompts
├── db/
│   ├── pools.js          # per-dbKey ConnectionPool cache
│   ├── safety.js         # runRead (rollback-only) + runWrite (gated)
│   └── introspection.js  # parameterized INFORMATION_SCHEMA / sys.* queries
└── tools/
    ├── index.js          # tool barrel
    ├── execute-read-query.js
    ├── execute-write-query.js
    ├── list-databases.js
    ├── describe-database.js
    ├── list-tables.js
    ├── list-views.js
    ├── list-indexes.js
    ├── list-foreign-keys.js
    ├── list-stored-procedures.js
    ├── describe-table.js
    └── describe-procedure.js
```

### Security model

- **Read isolation** - `execute_read_query` and every `list_*`/`describe_*` tool runs inside a transaction that is always rolled back. This is a **guardrail against accidental writes** (a `SELECT ... INTO new_table`, an INSERT smuggled past a comment), not a sandbox against an adversarial query: an explicit `COMMIT TRANSACTION` inside the user's SQL ends the outer transaction, and following statements run in autocommit mode. Use a least-privilege SQL login if you need real isolation against intentional misuse.
- **Write opt-in** - `execute_write_query` is gated by `MSSQL_ENABLE_WRITES=true`. When disabled it errors out _before_ a connection is acquired, so no resources are spent and no probing is possible.
- **Parameterized introspection** - every `list_*`/`describe_*` SQL uses `@param` placeholders rather than string concatenation; table identifiers are restricted by Zod to `/^[a-zA-Z0-9_#$@]+(?:\.[a-zA-Z0-9_#$@]+)?$/` (bare `Users` or two-part `dbo.Users` - no spaces, brackets, or three-part names) and bracket-quoted (`[schema].[table]`) for the CSV resource path. Identifiers with spaces or non-ASCII characters aren't supported by the introspection tools; use `execute_read_query` with raw SQL for those.
- **Cancellation** - tool handlers honor the MCP request `AbortSignal`; an aborted request fires `request.cancel()` on the underlying mssql request.
- **Least privilege** - the safest setup is a SQL login with only `SELECT` (and `EXECUTE` if needed) on the relevant schemas. The MCP layer reinforces that, it doesn't replace it.

## Testing

```bash
npm test
```

Runs unit tests with the built-in `node --test` runner. No external DB needed - the suite covers config parsing, validation, identifier escaping, the rollback-only contract, pool caching/retry, parameterized SQL placeholders, and tool registration metadata.

For a manual smoke test against the HTTP transport:

```bash
PORT=3000 npm run start:http &
curl -s http://localhost:3000/healthz
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

For interactive end-to-end testing against a real database, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

### Real-DB integration test (disposable)

`npm run integration` spins up a throwaway database, exercises every tool against real SQL Server, and drops it. The script also covers the streaming-cutoff and rollback-isolation paths that the unit tests can only mock.

Easiest setup is a one-shot Docker container:

```bash
docker run -d --name mcp-mssql-test \
  -e "ACCEPT_EULA=Y" \
  -e "MSSQL_SA_PASSWORD=YourStr0ng!Passw0rd" \
  -p 1433:1433 \
  mcr.microsoft.com/mssql/server:2022-latest

# wait ~10s for SQL Server to initialize, then:
MSSQL_TEST_PASSWORD='YourStr0ng!Passw0rd' npm run integration

# full cleanup:
docker rm -f mcp-mssql-test
```

The script creates `mcp_test_<timestamp>` inside the server, seeds it (Users, Orders with FK + index, a view, a stored procedure, 503 rows), runs ~20 tool-level assertions, and drops the database in a `finally` block - even on failure.

Override targets via `MSSQL_TEST_SERVER`, `MSSQL_TEST_PORT`, `MSSQL_TEST_USER` if you'd rather point it at an existing SQL Server, LocalDB, or Azure SQL.

## License

MIT - see [LICENSE](LICENSE).

## Author

Mihai-Nicolae Dulgheru <mihai.dulgheru18@gmail.com>
