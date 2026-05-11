require("dotenv").config();

const express = require("express");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createServer } = require("./server");
const { closeAllPools } = require("./db/pools");

const port = Number.parseInt(process.env.PORT || "3000", 10);

function methodNotAllowed(_req, res) {
  res
    .status(405)
    .set("Allow", "POST")
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
}

async function start() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: err.message },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  const httpServer = app.listen(port, () => {
    console.log(
      `mssql-mcp-node Streamable HTTP transport listening on :${port} (POST /mcp)`
    );
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    httpServer.close();
    await closeAllPools();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
