const express = require("express");
const bodyParser = require("body-parser");
const { listResources, readResource } = require("../modules/resources");
const { listTools, executeSql, getTableSchema } = require("../modules/tools");

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
 * POST /execute-sql
 * Executes an SQL query.
 * Expects a JSON body with "query" property.
 */
app.post("/execute-sql", async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "Parameter 'query' is required" });
  }

  try {
    const result = await executeSql(query);
    if (result.isError) {
      const error = JSON.parse(result.content[0].text);
      return res.status(500).json({ error: error.error });
    }
    const parsedResult = JSON.parse(result.content[0].text);
    res.json(parsedResult);
  } catch (error) {
    console.error(`Error executing SQL query: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /get-table-schema
 * Retrieves schema information for a specified table.
 * Expects a JSON body with "table" property.
 */
app.post("/get-table-schema", async (req, res) => {
  const { table } = req.body;
  if (!table) {
    return res.status(400).json({ error: "Parameter 'table' is required" });
  }

  try {
    const result = await getTableSchema(table);
    if (result.isError) {
      const error = JSON.parse(result.content[0].text);
      return res.status(500).json({ error: error.error });
    }
    const parsedResult = JSON.parse(result.content[0].text);
    res.json(parsedResult);
  } catch (error) {
    console.error(
      `Error retrieving schema for table '${table}': ${error.message}`
    );
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
