#!/usr/bin/env node
require("dotenv").config();

const Server = require("@modelcontextprotocol/sdk/server/index.js").Server;
const StdioServerTransport =
  require("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport;

const {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const packageJson = require("../package.json");
const { listResources, readResource } = require("./modules/resources");
const { listTools, executeSql, getTableSchema } = require("./modules/tools");

const server = new Server(
  {
    name: "mssql-mcp-node",
    version: packageJson.version,
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async function () {
  const resources = await listResources();
  return { resources };
});

// Read resource contents
server.setRequestHandler(ReadResourceRequestSchema, async function (request) {
  const uri = request.params.uri;
  const data = await readResource(uri);
  return {
    contents: [
      {
        uri,
        mimeType: "text/plain",
        text: data,
      },
    ],
  };
});

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, function () {
  const tools = listTools();
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async function (request) {
  const name = request.params.name;
  const toolArgs = request.params.arguments;

  if (name === "execute_sql") {
    return await executeSql(toolArgs.query);
  } else if (name === "get_table_schema") {
    return await getTableSchema(toolArgs.table);
  } else {
    throw new Error(`Unknown tool: ${name}`);
  }
});

async function runMCPServer() {
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.log("Server is running...");
  } catch (err) {
    console.error("Server error: ", err);
    process.exit(1);
  }
}

runMCPServer();
