# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mssql-mcp-node` is an npm-published MCP server (CommonJS, Node ≥ 18, no build step) that exposes one or more Microsoft SQL Server databases to MCP clients via 11 tools, a CSV table resource template, and two prompts. It runs over stdio (`src/index.js`, also the `bin`) or stateless Streamable HTTP (`src/http.js`, `POST /mcp`). README.md is the user-facing reference (tool catalog, env vars, security model) and must be updated when tools or env vars change.

## Commands

```bash
npm test                                   # all unit tests (node --test, no DB needed)
node --test test/safety.test.js            # one file
node --test --test-name-pattern="rollback" test/safety.test.js   # one test by name
npx eslint .                               # lint (no npm script for this)
npx prettier --check .                     # format check; --write to fix
npm run smoke                              # wire-level HTTP+stdio test with fake creds, no DB (scripts/smoke.js)
MSSQL_TEST_PASSWORD='...' npm run integration   # real SQL Server; creates+drops mcp_test_<ts> (see scripts/integration.js header for Docker one-liner)
npm start / npm run dev                    # stdio (dev = nodemon)
npm run start:http / npm run dev:http      # HTTP on $PORT (default 3000)
npx @modelcontextprotocol/inspector node src/index.js   # interactive e2e
```

Server needs `MSSQL_*` env (single-db) or `MSSQL_<NAME>_*` (multi-db) — see `.env.example`. `.env` is gitignored and loaded via dotenv in both entry points.

## Architecture

**Request flow:** entry point → `createServer()` in `src/server.js` → `tools/resources/prompts.registerAll(server)`. The HTTP entry creates a fresh `McpServer` + transport per POST (stateless mode); stdio creates one for the process lifetime. Both close all pools on SIGINT/SIGTERM.

**Tool module contract.** Every file in `src/tools/` exports `{ name, config, handler }` where `config` is the `registerTool` config (title, description, Zod `inputSchema`/`outputSchema` shapes, annotations). `src/tools/index.js` is an explicit array, not a directory scan — a new tool must be added there. Handlers all follow the same shape:

```js
const { dbKey: actualKey, config } = getConfig(dbKey);   // src/config.js
const pool = await getPool(actualKey, config);           // src/db/pools.js
const rows = await runRead(pool, async (request) => {...}, { signal: extra?.signal });  // src/db/safety.js
return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
```

Adding/removing a tool also requires updating the hardcoded count and name list in `test/tools.test.js`, the count in `scripts/smoke.js`, and the README tool catalog.

**Shared Zod shapes** live in `src/validation.js` (`dbKeyShape`, `paginationShape`, `tableIdentifier`, `queryString`, `MAX_LIMIT`). `tableIdentifier` deliberately rejects brackets, spaces, and three-part names; that regex is the injection boundary for introspection tools.

**Config** (`src/config.js`): env is parsed once and cached at module level. Presence of any `MSSQL_<NAME>_DATABASE` switches to multi-db mode (keys lowercased; per-db values fall back to bare `MSSQL_*`); otherwise single mode exposes `dbKey="maindb"`. Default dbKey = first key loaded. Tests call `_resetForTests()`.

**DB layer** (`src/db/`):

- `pools.js` — `Map<dbKey, Promise<ConnectionPool>>`. The _promise_ is cached so concurrent callers share one connect; a failed connect deletes the entry so the next call retries. Status map is exposed via `list_databases` with sanitized errors (name/code only — never `message`). Driver is injectable as the third arg for tests.
- `safety.js` — the read/write contract. `runRead` and `streamRead` wrap the callback in a `READ_COMMITTED` transaction that is **always rolled back** (guardrail against accidental writes, not a sandbox — README explains the `COMMIT TRANSACTION` caveat). `streamRead` uses mssql stream mode and calls `request.cancel()` after `offset + limit + 1` rows so `SELECT *` on a huge table can't OOM the process. It settles only on the driver's `done` event, never on `error` — `error` fires while the request still holds the connection, and rolling back then fails with `EREQINPROG` and leaks the pool connection (issue #8). Rollback failures other than `EABORT` are logged to stderr by `rollbackQuietly`. `runWrite` throws before touching the pool unless `MSSQL_ENABLE_WRITES=true`. All three honor the MCP `AbortSignal` via `attachAbort`. `mssql` is injectable via options for tests.
- `introspection.js` — SQL string constants only, all using `@param` placeholders. Never build introspection SQL by concatenation; add a constant here and bind inputs with `request.input(...)`.

**Resources** (`src/resources.js`): one template `mssql://{dbKey}@{tablePart}/data`; `list` enumerates up to 500 base tables per dbKey and silently skips DBs that fail to connect. The table identifier is bracket-quoted via `quoteTable` because it is interpolated (this is the one place identifiers are not bound as params).

**`stripSchemaDialect` in `src/server.js`** monkey-patches the SDK's private `_requestHandlers` map to delete `$schema` from advertised tool schemas (SDK 1.x emits draft-07; Claude Desktop's beta client rejected it). `test/server.test.js` guards this via an in-memory client. Remove when migrating to `@modelcontextprotocol/server` v2 / zod 4.

## Testing conventions

- `node:test` + `node:assert/strict`, no mocking library. Fakes are hand-rolled per test file (fake `mssql` with `Transaction`/`Request` constructors, fake `ConnectionPool`) and injected through the DI hooks above rather than module mocking.
- Tests that touch env (e.g. `MSSQL_ENABLE_WRITES`) save/restore `process.env` in `finally`.
- Unit tests must not need a database. Real-DB behavior (streaming cutoff, rollback isolation) is covered only by `scripts/integration.js`.

## Style

Prettier (double quotes, semicolons, `trailingComma: es5`, 2 spaces, 80 cols) and ESLint flat config (`js/recommended`, `no-undef` off, unused args must be `_`-prefixed). LF line endings are enforced by `.gitattributes`. Release commits are `release: x.y.z`; the server advertises `package.json` `version` to clients.
