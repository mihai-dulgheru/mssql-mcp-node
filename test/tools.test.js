const test = require("node:test");
const assert = require("node:assert/strict");

const tools = require("../src/tools");

test("registerAll registers every tool module exactly once", () => {
  const seen = [];
  const fakeServer = {
    registerTool(name, config, handler) {
      seen.push({
        name,
        hasConfig: typeof config === "object",
        hasHandler: typeof handler === "function",
      });
      assert.ok(config.description, `${name} should have a description`);
      assert.ok(config.annotations, `${name} should have annotations`);
      assert.ok(
        ["boolean"].includes(typeof config.annotations.readOnlyHint),
        `${name} annotations should include readOnlyHint`
      );
    },
  };
  tools.registerAll(fakeServer);
  assert.equal(seen.length, 11);
  const names = seen.map((s) => s.name).sort();
  assert.deepEqual(names, [
    "describe_database",
    "describe_procedure",
    "describe_table",
    "execute_read_query",
    "execute_write_query",
    "list_databases",
    "list_foreign_keys",
    "list_indexes",
    "list_stored_procedures",
    "list_tables",
    "list_views",
  ]);
});

test("execute_write_query rejects before connecting when writes disabled", async () => {
  const prev = process.env.MSSQL_ENABLE_WRITES;
  delete process.env.MSSQL_ENABLE_WRITES;
  try {
    const { handler } = require("../src/tools/execute-write-query");
    await assert.rejects(
      () => handler({ query: "INSERT INTO x VALUES (1)" }, {}),
      /writes are disabled/i
    );
  } finally {
    if (prev !== undefined) process.env.MSSQL_ENABLE_WRITES = prev;
  }
});

test("every tool module exports { name, config, handler }", () => {
  for (const mod of tools.modules) {
    assert.equal(typeof mod.name, "string");
    assert.equal(typeof mod.config, "object");
    assert.equal(typeof mod.handler, "function");
    assert.match(
      mod.name,
      /^[a-z][a-z0-9_]*$/,
      "tool names must be snake_case"
    );
  }
});
