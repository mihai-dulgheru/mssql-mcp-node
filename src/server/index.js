const express = require("express");
const bodyParser = require("body-parser");
const { listResources, readResource } = require("../modules/resources");
const { listTools, callTool } = require("../modules/tools");

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

/**
 * GET /resources
 * Lists SQL Server tables as resources.
 */
app.get("/resources", async (req, res) => {
  try {
    const resources = await listResources();
    res.json(resources);
  } catch (error) {
    console.error("Error listing resources:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /resource
 * Reads data from a resource.
 * Expects query parameter "uri".
 */
app.get("/resource", async (req, res) => {
  const uri = req.query.uri;
  if (!uri) {
    return res.status(400).json({ error: "Parameter 'uri' is required" });
  }
  try {
    const data = await readResource(uri);
    res.type("text/plain").send(data);
  } catch (error) {
    console.error(`Error reading resource ${uri}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /tools
 * Lists available MSSQL tools.
 */
app.get("/tools", (req, res) => {
  try {
    const tools = listTools();
    res.json(tools);
  } catch (error) {
    console.error("Error listing tools:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /call-tool
 * Executes a tool.
 * Expects a JSON body with "name" (string) and "arguments" (object).
 */
app.post("/call-tool", async (req, res) => {
  const { name, arguments: toolArgs } = req.body;
  if (!name || !toolArgs) {
    return res
      .status(400)
      .json({ error: "Parameters 'name' and 'arguments' are required" });
  }
  try {
    const result = await callTool(name, toolArgs);
    res.json(result);
  } catch (error) {
    console.error(`Error calling tool ${name}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = {
  app,
  /**
   * Starts the Express server on the specified port.
   */
  startServer: () => {
    app.listen(port, () => {
      console.log(`MSSQL MCP server is running on port ${port}`);
    });
  },
};
