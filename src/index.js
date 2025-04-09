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
const { listTools, callTool } = require("./modules/tools");

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

server.setRequestHandler(ListResourcesRequestSchema, async function () {
  const resources = await listResources();
  return { resources: resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async function (request) {
  const uri = request.params.uri;
  const data = await readResource(uri);
  return {
    contents: [
      {
        uri: uri,
        mimeType: "text/plain",
        text: data,
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, function () {
  const tools = listTools();
  return { tools: tools };
});

server.setRequestHandler(CallToolRequestSchema, function (request) {
  const name = request.params.name;
  const toolArgs = request.params.arguments;
  return callTool(name, toolArgs);
});

async function runMCPServer() {
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
  } catch (err) {
    console.error("Server error: ", err);
    process.exit(1);
  }
}

runMCPServer();
