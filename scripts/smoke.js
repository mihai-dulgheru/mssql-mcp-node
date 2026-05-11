#!/usr/bin/env node
/**
 * MCP wire-level smoke test.
 *
 * Spins up the HTTP transport with fake DB credentials and exercises every
 * code path that doesn't require a real SQL Server. Verifies:
 *   - server boots, healthz responds
 *   - initialize advertises tools/resources/prompts capabilities
 *   - all 11 tools are listed with correct annotations and schemas
 *   - no `annotations.title` (de-duplicated)
 *   - both prompts are listed with correct argsSchema
 *   - prompts/get renders the expected text
 *   - validation rejects bad input
 *   - resources/read rejects malformed URIs
 *   - list_databases returns sanitized structuredContent
 *   - execute_write_query rejects with "writes are disabled" BEFORE connect
 *   - With MSSQL_ENABLE_WRITES=true, execute_write_query now reaches the connect layer
 *
 * Exits 0 on success, 1 on any failure.
 */
const { spawn } = require("node:child_process");
const http = require("node:http");

const PORT = 3088;
let serverProc;
let pass = 0;
let fail = 0;
const failures = [];

function log(name, ok, detail = "") {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? " - " + detail : ""}`);
  if (ok) pass++;
  else {
    fail++;
    failures.push(name);
  }
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, ["src/http.js"], {
      env: {
        ...process.env,
        PORT: String(PORT),
        MSSQL_SERVER: "fake.example.com",
        MSSQL_USER: "u",
        MSSQL_PASSWORD: "p",
        MSSQL_DATABASE: "d",
        ...env,
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let booted = false;
    serverProc.stdout.on("data", (d) => {
      const s = d.toString();
      if (s.includes("listening on") && !booted) {
        booted = true;
        resolve();
      }
    });
    serverProc.stderr.on("data", (d) =>
      process.stderr.write(`[server stderr] ${d}`)
    );
    serverProc.on("exit", (code) => {
      if (!booted)
        reject(new Error(`server exited with ${code} before booting`));
    });
    setTimeout(() => {
      if (!booted) reject(new Error("server boot timeout"));
    }, 10000);
  });
}

async function stopServer() {
  if (!serverProc) return;
  serverProc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 200));
  if (!serverProc.killed) serverProc.kill("SIGKILL");
}

function rpc(method, params, id = Date.now()) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            reject(new Error(`bad JSON from ${method}: ${buf}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "localhost", port: PORT, path }, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      })
      .on("error", reject);
  });
}

const EXPECTED_TOOLS = [
  "execute_read_query",
  "execute_write_query",
  "list_databases",
  "describe_database",
  "list_tables",
  "list_views",
  "list_indexes",
  "list_foreign_keys",
  "list_stored_procedures",
  "describe_table",
  "describe_procedure",
];

async function phase1_writesDisabled() {
  console.log("\n=== Phase 1: writes disabled (default) ===\n");

  // healthz
  const h = await getJson("/healthz");
  log(
    "healthz responds 200 with ok:true",
    h.status === 200 && h.body?.ok === true
  );

  // method-not-allowed sentinels
  const get = await getJson("/mcp");
  log("GET /mcp returns 405", get.status === 405);

  // initialize
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.1" },
  });
  log("initialize succeeds", init.status === 200 && init.body.result);
  log(
    "initialize advertises tools/resources/prompts",
    !!(
      init.body.result?.capabilities?.tools &&
      init.body.result?.capabilities?.resources &&
      init.body.result?.capabilities?.prompts
    )
  );
  log(
    "serverInfo.version is 3.0.0",
    init.body.result?.serverInfo?.version === "3.0.0"
  );

  // tools/list
  const tl = await rpc("tools/list");
  const tools = tl.body.result?.tools || [];
  log("tools/list returns 11 tools", tools.length === 11);
  const names = tools.map((t) => t.name).sort();
  log(
    "tool names match expected set",
    JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort())
  );

  // every tool must have annotations with readOnlyHint as boolean, no annotations.title
  let annotationsClean = true;
  let outputSchemasPresent = true;
  let inputSchemasPresent = true;
  let descriptionsRich = true;
  for (const t of tools) {
    if (!t.annotations || typeof t.annotations.readOnlyHint !== "boolean") {
      annotationsClean = false;
    }
    if ("title" in (t.annotations || {})) {
      annotationsClean = false;
      console.log(`    ! ${t.name} still has annotations.title`);
    }
    if (!t.outputSchema || !t.outputSchema.properties) {
      outputSchemasPresent = false;
    }
    if (!t.inputSchema || !t.inputSchema.properties) {
      inputSchemasPresent = false;
    }
    if (!t.description || t.description.length < 30) {
      descriptionsRich = false;
    }
  }
  log("no tool has annotations.title (de-duplicated)", annotationsClean);
  log("every tool exposes outputSchema", outputSchemasPresent);
  log("every tool exposes inputSchema", inputSchemasPresent);
  log("every tool has a non-trivial description", descriptionsRich);

  // execute_write_query annotations
  const ew = tools.find((t) => t.name === "execute_write_query");
  log(
    "execute_write_query is destructive + not readOnly",
    ew.annotations.readOnlyHint === false &&
      ew.annotations.destructiveHint === true
  );

  // execute_read_query annotations
  const er = tools.find((t) => t.name === "execute_read_query");
  log(
    "execute_read_query is readOnly + idempotent",
    er.annotations.readOnlyHint === true &&
      er.annotations.idempotentHint === true
  );

  // list_foreign_keys has pagination shape
  const fk = tools.find((t) => t.name === "list_foreign_keys");
  const fkInputs = Object.keys(fk.inputSchema.properties || {});
  log(
    "list_foreign_keys accepts table + dbKey + limit + offset",
    fkInputs.includes("table") &&
      fkInputs.includes("dbKey") &&
      fkInputs.includes("limit") &&
      fkInputs.includes("offset")
  );

  // execute_read_query has limit + offset
  const erInputs = Object.keys(er.inputSchema.properties || {});
  log(
    "execute_read_query accepts query + dbKey + limit + offset",
    erInputs.includes("query") &&
      erInputs.includes("dbKey") &&
      erInputs.includes("limit") &&
      erInputs.includes("offset")
  );

  // prompts/list
  const pl = await rpc("prompts/list");
  const prompts = pl.body.result?.prompts || [];
  log("prompts/list returns 2 prompts", prompts.length === 2);
  const promptNames = new Set(prompts.map((p) => p.name));
  log(
    "prompts include explore_database and summarize_table",
    promptNames.has("explore_database") && promptNames.has("summarize_table")
  );
  const summarize = prompts.find((p) => p.name === "summarize_table");
  const summarizeArgs = (summarize.arguments || []).reduce(
    (acc, a) => ({ ...acc, [a.name]: a }),
    {}
  );
  log(
    "summarize_table marks `table` as required",
    summarizeArgs.table?.required === true &&
      summarizeArgs.dbKey?.required === false
  );

  // prompts/get
  const pg = await rpc("prompts/get", {
    name: "summarize_table",
    arguments: { table: "dbo.Users", dbKey: "main" },
  });
  const text = pg.body.result?.messages?.[0]?.content?.text || "";
  log(
    "summarize_table renders user-supplied table and dbKey",
    text.includes("dbo.Users") && text.includes('dbKey="main"')
  );
  log(
    "summarize_table mentions describe_table, list_indexes, list_foreign_keys, execute_read_query",
    [
      "describe_table",
      "list_indexes",
      "list_foreign_keys",
      "execute_read_query",
    ].every((s) => text.includes(s))
  );

  // explore_database without dbKey
  const pg2 = await rpc("prompts/get", {
    name: "explore_database",
    arguments: {},
  });
  const t2 = pg2.body.result?.messages?.[0]?.content?.text || "";
  log(
    "explore_database without dbKey says 'configured database'",
    t2.includes("configured database")
  );

  // list_databases - sanitized output
  const lb = await rpc("tools/call", { name: "list_databases", arguments: {} });
  const sc = lb.body.result?.structuredContent;
  log(
    "list_databases returns structuredContent.count=1, mode=single",
    sc?.count === 1 && sc?.mode === "single"
  );
  log(
    "list_databases does not expose password field",
    JSON.stringify(sc).includes("password") === false
  );

  // execute_write_query - should reject early
  const ww = await rpc("tools/call", {
    name: "execute_write_query",
    arguments: { query: "INSERT INTO x VALUES (1)" },
  });
  const wwText = ww.body.result?.content?.[0]?.text || "";
  log(
    "execute_write_query (writes off) returns 'writes are disabled' error",
    ww.body.result?.isError === true && /writes are disabled/i.test(wwText)
  );

  // Validation: empty query
  const eq = await rpc("tools/call", {
    name: "execute_read_query",
    arguments: { query: "" },
  });
  log(
    "execute_read_query rejects empty query (validation)",
    eq.body.result?.isError === true || eq.body.error
  );

  // Validation: invalid table identifier
  const bt = await rpc("tools/call", {
    name: "describe_table",
    arguments: { table: "Users; DROP TABLE x" },
  });
  log(
    "describe_table rejects identifier with SQL injection chars",
    bt.body.result?.isError === true || bt.body.error
  );

  // Validation: limit > MAX_LIMIT (1000)
  const big = await rpc("tools/call", {
    name: "list_tables",
    arguments: { limit: 10000 },
  });
  log(
    "list_tables rejects limit > 1000",
    big.body.result?.isError === true || big.body.error
  );

  // resources/templates/list
  const rt = await rpc("resources/templates/list");
  const templates = rt.body.result?.resourceTemplates || [];
  log("resources/templates/list returns one template", templates.length === 1);
  log(
    "template URI is mssql://{dbKey}@{tablePart}/data",
    templates[0]?.uriTemplate === "mssql://{dbKey}@{tablePart}/data"
  );

  // resources/read with malformed URI (no dbKey@)
  const badRead = await rpc("resources/read", {
    uri: "mssql://dbo.Users/data",
  });
  // The SDK will return an error before parseUri is called because the URI doesn't match the template
  log(
    "resources/read rejects dbKey-less URI",
    !!badRead.body.error || badRead.body.result?.isError === true
  );

  // describe_table - calls into pool layer, will fail connect to fake.example.com.
  // We just want to confirm the validation passes and the failure is a connect error, not a schema error.
  const dt = await rpc("tools/call", {
    name: "describe_table",
    arguments: { table: "dbo.Users" },
  });
  const dtText =
    dt.body.result?.content?.[0]?.text || dt.body.error?.message || "";
  log(
    "describe_table reaches connect layer (errors with ENOTFOUND / EAI_AGAIN / login)",
    dt.body.result?.isError === true &&
      /ENOTFOUND|getaddrinfo|EAI_AGAIN|Failed to connect|Login failed/i.test(
        dtText
      )
  );
}

async function phase2_writesEnabled() {
  console.log(
    "\n=== Phase 2: writes enabled (restart with MSSQL_ENABLE_WRITES=true) ===\n"
  );
  await stopServer();
  await startServer({ MSSQL_ENABLE_WRITES: "true" });

  const ww = await rpc("tools/call", {
    name: "execute_write_query",
    arguments: { query: "INSERT INTO x VALUES (1)" },
  });
  const text =
    ww.body.result?.content?.[0]?.text || ww.body.error?.message || "";
  log(
    "execute_write_query (writes on) passes the gate and hits connect layer",
    ww.body.result?.isError === true &&
      /ENOTFOUND|getaddrinfo|EAI_AGAIN|Failed to connect|Login failed/i.test(
        text
      ) &&
      !/writes are disabled/i.test(text)
  );
}

async function phase3_stdio() {
  console.log("\n=== Phase 3: stdio entrypoint ===\n");
  // Spawn src/index.js, feed an `initialize` JSON-RPC line, expect a response.
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ["src/index.js"], {
      env: {
        ...process.env,
        MSSQL_SERVER: "fake.example.com",
        MSSQL_USER: "u",
        MSSQL_PASSWORD: "p",
        MSSQL_DATABASE: "d",
      },
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let done = false;
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
      if (line && !done) {
        try {
          const msg = JSON.parse(line);
          done = true;
          log(
            "stdio: initialize returns serverInfo.name=mssql-mcp-node",
            msg.result?.serverInfo?.name === "mssql-mcp-node"
          );
          log(
            "stdio: initialize advertises tools capability",
            !!msg.result?.capabilities?.tools
          );
          proc.kill();
          resolve();
        } catch {
          // partial; wait
        }
      }
    });
    proc.stderr.on("data", (d) => process.stderr.write(`[stdio stderr] ${d}`));
    proc.on("exit", () => {
      if (!done) {
        log(
          "stdio: initialize handshake completed",
          false,
          "process exited without responding"
        );
        resolve();
      }
    });

    const req =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.0.1" },
        },
      }) + "\n";
    proc.stdin.write(req);

    setTimeout(() => {
      if (!done) {
        log("stdio: initialize handshake completed", false, "5s timeout");
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve();
      }
    }, 5000);
  });
}

async function main() {
  try {
    await startServer({});
    await phase1_writesDisabled();
    await phase2_writesEnabled();
    await stopServer();
    await phase3_stdio();
  } catch (err) {
    console.error("Smoke fatal error:", err);
    fail++;
    failures.push(`fatal: ${err.message}`);
  } finally {
    await stopServer();
  }

  console.log(`\n=== Summary: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log("Failures:");
    for (const name of failures) console.log("  -", name);
    process.exit(1);
  }
  process.exit(0);
}

main();
