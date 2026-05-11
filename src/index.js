#!/usr/bin/env node
require("dotenv").config();

const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = require("./server");
const { closeAllPools } = require("./db/pools");

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      // ignore
    }
    await closeAllPools();
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  try {
    await server.connect(transport);
  } catch (err) {
    console.error("Server error:", err);
    await shutdown(1);
  }
}

main();
