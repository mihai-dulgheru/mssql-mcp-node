const test = require("node:test");
const assert = require("node:assert/strict");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const Ajv = require("ajv");
const Ajv2020 = require("ajv/dist/2020");

const { createServer } = require("../src/server");
const { modules } = require("../src/tools");

let tools;
test.before(async () => {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    tools = (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
});

test("advertised tool schemas declare no $schema dialect (2020-12 default)", () => {
  assert.equal(tools.length, modules.length);
  for (const t of tools) {
    assert.equal(t.inputSchema.$schema, undefined, `${t.name} inputSchema`);
    assert.equal(t.outputSchema?.$schema, undefined, `${t.name} outputSchema`);
  }
});

test("advertised tool schemas compile under both draft-07 and 2020-12 validators", () => {
  const draft07 = new Ajv({ strict: false });
  const draft2020 = new Ajv2020({ strict: false });
  for (const t of tools) {
    for (const schema of [t.inputSchema, t.outputSchema].filter(Boolean)) {
      assert.doesNotThrow(() => draft07.compile(schema), `${t.name} draft-07`);
      assert.doesNotThrow(() => draft2020.compile(schema), `${t.name} 2020-12`);
    }
  }
});
