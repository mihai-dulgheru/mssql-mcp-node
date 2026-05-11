#!/usr/bin/env node
/**
 * Integration test against a real SQL Server.
 *
 * Requires a reachable SQL Server. Easiest setup:
 *
 *   docker run -d --name mcp-mssql-test \
 *     -e "ACCEPT_EULA=Y" \
 *     -e "MSSQL_SA_PASSWORD=YourStr0ng!Passw0rd" \
 *     -p 1433:1433 \
 *     mcr.microsoft.com/mssql/server:2022-latest
 *
 *   # wait ~10s for SQL Server to finish initializing
 *
 *   MSSQL_TEST_PASSWORD='YourStr0ng!Passw0rd' npm run integration
 *
 *   docker rm -f mcp-mssql-test    # full cleanup
 *
 * Env vars (all optional except password):
 *   MSSQL_TEST_SERVER   default: localhost
 *   MSSQL_TEST_PORT     default: 1433
 *   MSSQL_TEST_USER     default: sa
 *   MSSQL_TEST_PASSWORD required
 *
 * What it does:
 *   1. Connects to `master`, creates a temporary database `mcp_test_<timestamp>`.
 *   2. Bootstraps schema: Users + Orders (FK), a view, a stored proc, an index, 500+ Orders rows.
 *   3. Loads the MCP tool modules pointed at the test DB.
 *   4. Exercises every tool and asserts the SQL-level behavior.
 *   5. Drops the temporary database in finally (even on failure).
 *
 * Coverage:
 *   - list_databases, describe_database, list_tables, list_views, list_stored_procedures
 *   - describe_table, describe_procedure, list_indexes, list_foreign_keys (with pagination)
 *   - execute_read_query: returns rows, streaming cutoff (truncated=true), rollback isolation
 *   - execute_write_query: rejected when writes off, persists when writes on
 */
const sql = require("mssql");

const SERVER = process.env.MSSQL_TEST_SERVER || "localhost";
const PORT = process.env.MSSQL_TEST_PORT
  ? Number(process.env.MSSQL_TEST_PORT)
  : 1433;
const USER = process.env.MSSQL_TEST_USER || "sa";
const PASSWORD = process.env.MSSQL_TEST_PASSWORD;

if (!PASSWORD) {
  console.error(
    "MSSQL_TEST_PASSWORD is required. See header comment for setup instructions."
  );
  process.exit(2);
}

const TEST_DB = `mcp_test_${Date.now()}`;
const masterConfig = {
  server: SERVER,
  port: PORT,
  user: USER,
  password: PASSWORD,
  database: "master",
  options: { encrypt: false, trustServerCertificate: true },
};
const testConfig = { ...masterConfig, database: TEST_DB };

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`[PASS] ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`[FAIL] ${name}${detail ? " - " + detail : ""}`);
  }
}

async function bootstrap() {
  console.log(`Connecting to ${SERVER}:${PORT} as ${USER}…`);
  const master = new sql.ConnectionPool(masterConfig);
  await master.connect();
  console.log(`Creating database [${TEST_DB}]…`);
  await master.request().query(`CREATE DATABASE [${TEST_DB}]`);
  await master.close();

  const pool = new sql.ConnectionPool(testConfig);
  await pool.connect();
  await pool.request().batch(`
    CREATE TABLE dbo.Users (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      Name NVARCHAR(100) NOT NULL,
      Email NVARCHAR(200)
    );
  `);
  await pool.request().batch(`
    CREATE TABLE dbo.Orders (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      UserId INT NOT NULL,
      Amount DECIMAL(10,2),
      CONSTRAINT FK_Orders_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id)
    );
  `);
  await pool
    .request()
    .batch(`CREATE INDEX IX_Orders_UserId ON dbo.Orders(UserId);`);
  await pool.request().batch(`
    INSERT INTO dbo.Users (Name, Email) VALUES
      ('Alice', 'a@example.com'),
      ('Bob', 'b@example.com');
  `);
  await pool.request().batch(`
    INSERT INTO dbo.Orders (UserId, Amount) VALUES
      (1, 99.95), (1, 12.50), (2, 7.00);
  `);
  // 500 extra Orders rows for streaming-cutoff coverage
  await pool.request().batch(`
    DECLARE @i INT = 0;
    WHILE @i < 500 BEGIN
      INSERT INTO dbo.Orders (UserId, Amount) VALUES (1, CAST(@i AS DECIMAL(10,2)));
      SET @i = @i + 1;
    END
  `);
  await pool.request().batch(`
    CREATE VIEW dbo.UsersWithOrders AS
      SELECT u.Id, u.Name, COUNT(o.Id) AS OrderCount
      FROM dbo.Users u
      LEFT JOIN dbo.Orders o ON o.UserId = u.Id
      GROUP BY u.Id, u.Name;
  `);
  await pool.request().batch(`
    CREATE PROCEDURE dbo.GetUserOrders @userId INT AS
    BEGIN
      SELECT Id, UserId, Amount FROM dbo.Orders WHERE UserId = @userId;
    END
  `);
  await pool.close();
  console.log(`Bootstrapped schema (Users, Orders, view, proc, 503 rows).`);
}

async function teardown() {
  try {
    // Close MCP pools first so they don't hold the DB
    require("../src/db/pools").closeAllPools &&
      (await require("../src/db/pools").closeAllPools());
  } catch {
    // module may not have been loaded
  }
  try {
    const master = new sql.ConnectionPool(masterConfig);
    await master.connect();
    // Kick any leftover sessions, then drop
    await master
      .request()
      .query(
        `IF DB_ID('${TEST_DB}') IS NOT NULL ALTER DATABASE [${TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`
      );
    await master
      .request()
      .query(`IF DB_ID('${TEST_DB}') IS NOT NULL DROP DATABASE [${TEST_DB}]`);
    await master.close();
    console.log(`Dropped database [${TEST_DB}].`);
  } catch (err) {
    console.error(
      `Teardown error (manual cleanup may be needed for ${TEST_DB}):`,
      err.message
    );
  }
}

async function runTests() {
  // Point the MCP config at our test DB.
  process.env.MSSQL_SERVER = SERVER;
  process.env.MSSQL_PORT = String(PORT);
  process.env.MSSQL_USER = USER;
  process.env.MSSQL_PASSWORD = PASSWORD;
  process.env.MSSQL_DATABASE = TEST_DB;
  process.env.MSSQL_ENCRYPT = "false";
  process.env.MSSQL_TRUST_SERVER_CERTIFICATE = "true";
  delete process.env.MSSQL_ENABLE_WRITES;

  // Fresh config load.
  const config = require("../src/config");
  config._resetForTests();

  const tools = require("../src/tools").modules;
  const findTool = (name) => tools.find((t) => t.name === name);

  // ── Catalog tools ──
  let r = await findTool("list_databases").handler({});
  check(
    "list_databases shows test DB",
    r.structuredContent.databases[0].database === TEST_DB
  );
  check("list_databases mode = single", r.structuredContent.mode === "single");

  r = await findTool("describe_database").handler({});
  check(
    "describe_database tableCount = 2",
    r.structuredContent.tableCount === 2,
    `got ${r.structuredContent.tableCount}`
  );
  check("describe_database viewCount = 1", r.structuredContent.viewCount === 1);
  check(
    "describe_database procedureCount = 1",
    r.structuredContent.procedureCount === 1
  );

  r = await findTool("list_tables").handler({ limit: 100, offset: 0 });
  const tableNames = r.structuredContent.tables.map((t) => t.name).sort();
  check(
    "list_tables returns [Orders, Users]",
    JSON.stringify(tableNames) === JSON.stringify(["Orders", "Users"])
  );
  check("list_tables.total matches", r.structuredContent.total === 2);

  r = await findTool("list_views").handler({ limit: 100, offset: 0 });
  check(
    "list_views finds UsersWithOrders",
    r.structuredContent.views.some((v) => v.name === "UsersWithOrders")
  );

  r = await findTool("list_stored_procedures").handler({
    limit: 100,
    offset: 0,
  });
  check(
    "list_stored_procedures finds GetUserOrders",
    r.structuredContent.procedures.some((p) => p.name === "GetUserOrders")
  );

  // ── Per-object inspection ──
  r = await findTool("describe_table").handler({ table: "dbo.Users" });
  const cols = r.structuredContent.columns.map((c) => c.name);
  check(
    "describe_table Users has Id/Name/Email",
    JSON.stringify(cols) === JSON.stringify(["Id", "Name", "Email"])
  );

  r = await findTool("describe_table").handler({ table: "Orders" });
  check(
    "describe_table works without schema prefix",
    r.structuredContent.columns.length === 3
  );

  r = await findTool("list_indexes").handler({ table: "dbo.Orders" });
  check(
    "list_indexes Orders has PK + IX_Orders_UserId",
    r.structuredContent.indexes.some((i) => i.isPrimaryKey) &&
      r.structuredContent.indexes.some((i) => i.index === "IX_Orders_UserId")
  );

  r = await findTool("list_foreign_keys").handler({ limit: 100, offset: 0 });
  const fk = r.structuredContent.foreignKeys.find(
    (f) => f.fromTable === "dbo.Orders" && f.toTable === "dbo.Users"
  );
  check(
    "list_foreign_keys finds Orders.UserId -> Users.Id",
    fk?.fromColumn === "UserId" && fk?.toColumn === "Id"
  );
  check(
    "list_foreign_keys.total reports a number",
    typeof r.structuredContent.total === "number" &&
      r.structuredContent.total >= 1
  );

  r = await findTool("describe_procedure").handler({
    procedure: "dbo.GetUserOrders",
  });
  check(
    "describe_procedure GetUserOrders has @userId param",
    r.structuredContent.parameters.some(
      (p) => p.name === "@userId" && p.type === "int"
    )
  );

  // ── execute_read_query ──
  r = await findTool("execute_read_query").handler({
    query: "SELECT * FROM dbo.Users ORDER BY Id",
    limit: 100,
    offset: 0,
  });
  check(
    "execute_read_query returns 2 user rows",
    r.structuredContent.rowCount === 2 &&
      r.structuredContent.truncated === false
  );

  // Streaming cutoff: 503 Orders rows, limit=20 - must truncate
  r = await findTool("execute_read_query").handler({
    query: "SELECT * FROM dbo.Orders",
    limit: 20,
    offset: 0,
  });
  check(
    "execute_read_query streams + truncates at limit=20",
    r.structuredContent.rowCount === 20 &&
      r.structuredContent.truncated === true,
    `rowCount=${r.structuredContent.rowCount}, truncated=${r.structuredContent.truncated}, totalSeen=${r.structuredContent.totalRowsSeen}`
  );
  check(
    "execute_read_query totalRowsSeen is bounded (cancel fired early)",
    r.structuredContent.totalRowsSeen >= 21 &&
      r.structuredContent.totalRowsSeen < 503,
    `totalRowsSeen=${r.structuredContent.totalRowsSeen} (should be ~21–30, not 503)`
  );

  // offset
  r = await findTool("execute_read_query").handler({
    query: "SELECT TOP 50 * FROM dbo.Orders ORDER BY Id",
    limit: 10,
    offset: 5,
  });
  check(
    "execute_read_query honors offset",
    r.structuredContent.rowCount === 10 &&
      r.structuredContent.recordset[0].Id !== undefined
  );

  // Rollback isolation: try to write inside execute_read_query, then verify it didn't persist.
  // INSERT statements just don't emit row events; streamRead returns empty.
  try {
    await findTool("execute_read_query").handler({
      query:
        "INSERT INTO dbo.Users (Name, Email) VALUES ('Mallory', 'm@example.com')",
      limit: 100,
      offset: 0,
    });
  } catch {
    // mssql may throw because there's no recordset - that's fine, the txn still rolls back
  }
  r = await findTool("execute_read_query").handler({
    query: "SELECT COUNT(*) AS c FROM dbo.Users WHERE Name = 'Mallory'",
    limit: 10,
    offset: 0,
  });
  check(
    "rollback-only contract: INSERT inside execute_read_query does NOT persist",
    r.structuredContent.recordset[0].c === 0
  );

  // ── execute_write_query ──
  let threw = false;
  try {
    await findTool("execute_write_query").handler({
      query:
        "INSERT INTO dbo.Users (Name, Email) VALUES ('Eve', 'e@example.com')",
    });
  } catch (err) {
    threw = /writes are disabled/i.test(err.message);
  }
  check("execute_write_query rejects when MSSQL_ENABLE_WRITES unset", threw);

  // Enable writes and confirm both the gate and the actual write
  process.env.MSSQL_ENABLE_WRITES = "true";
  r = await findTool("execute_write_query").handler({
    query:
      "INSERT INTO dbo.Users (Name, Email) VALUES ('Charlie', 'c@example.com')",
  });
  check(
    "execute_write_query reports rowsAffected=1",
    r.structuredContent.rowsAffected[0] === 1
  );

  // Verify the write actually persisted (read tool sees Charlie)
  r = await findTool("execute_read_query").handler({
    query: "SELECT COUNT(*) AS c FROM dbo.Users WHERE Name = 'Charlie'",
    limit: 10,
    offset: 0,
  });
  check(
    "execute_write_query insert persists across calls",
    r.structuredContent.recordset[0].c === 1
  );

  // Verify the Users row count is now 3 (Alice, Bob, Charlie) - Mallory was rolled back
  r = await findTool("execute_read_query").handler({
    query: "SELECT COUNT(*) AS c FROM dbo.Users",
    limit: 10,
    offset: 0,
  });
  check(
    "Final Users count = 3 (Alice, Bob, Charlie); Mallory never landed",
    r.structuredContent.recordset[0].c === 3
  );

  delete process.env.MSSQL_ENABLE_WRITES;
}

async function main() {
  let ok = false;
  try {
    await bootstrap();
    await runTests();
    ok = fail === 0;
  } catch (err) {
    console.error("Integration error:", err);
    fail++;
    failures.push(`fatal: ${err.message}`);
  } finally {
    await teardown();
  }

  console.log(`\n=== Integration: ${pass} pass / ${fail} fail ===`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log("  -", f);
  }
  process.exit(ok ? 0 : 1);
}

main();
