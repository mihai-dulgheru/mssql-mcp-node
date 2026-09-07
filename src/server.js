const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const pkg = require("../package.json");
const tools = require("./tools");
const resources = require("./resources");
const prompts = require("./prompts");

// ponytail: SDK 1.x (zod-to-json-schema) stamps `$schema: draft-07` on every advertised tool
// schema. @modelcontextprotocol/client 2.0.0-beta.x (bundled in Claude Desktop, Sep 2026) rejects
// any dialect but 2020-12 (issue #7); client 2.0.0 GA accepts draft-07 again. Absent `$schema`
// means 2020-12 per spec and is the one form every client generation accepts; our schemas are
// valid under both drafts. SDK 1.x has no public hook for this, hence the private map;
// test/server.test.js guards it. Remove after migrating to @modelcontextprotocol/server v2
// (needs zod 4), which emits 2020-12 natively.
function stripSchemaDialect(server) {
  const handlers = server.server._requestHandlers;
  const listTools = handlers?.get("tools/list");
  if (!listTools) return;
  handlers.set("tools/list", async (req, extra) => {
    const result = await listTools(req, extra);
    for (const tool of result.tools) {
      delete tool.inputSchema.$schema;
      if (tool.outputSchema) delete tool.outputSchema.$schema;
    }
    return result;
  });
}

function createServer() {
  const server = new McpServer(
    { name: "mssql-mcp-node", version: pkg.version },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );
  tools.registerAll(server);
  stripSchemaDialect(server);
  resources.registerAll(server);
  prompts.registerAll(server);
  return server;
}

module.exports = { createServer };
