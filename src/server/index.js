const express = require("express");
const bodyParser = require("body-parser");
const { listResources, readResource } = require("../modules/resources");
const {
  listTools,
  executeSql,
  getTableSchema,
  listDatabases,
} = require("../modules/tools");
const { validate, dbKeySchema } = require("../validation");
const { dbConfigs } = require("../config");

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// Error handling middleware
const errorHandler = (err, req, res, _next) => {
  console.error(`Error processing request: ${err.message}`);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message,
    path: req.path,
    timestamp: new Date().toISOString(),
  });
};

// Validation middleware for dbKey
const validateDbKey = (req, _res, next) => {
  // Check if req.query or req.body exists before trying to access their properties
  const dbKey = req.query?.dbKey || req.body?.dbKey;
  if (dbKey) {
    try {
      validate(dbKeySchema, { dbKey });
      next();
    } catch (error) {
      error.statusCode = 400;
      next(error);
    }
  } else {
    next();
  }
};

// Apply validation middleware to all routes
app.use(validateDbKey);

/**
 * GET /resources
 * Lists SQL Server tables as resources.
 * Accepts optional dbKey as a query parameter.
 */
app.get("/resources", async (req, res, next) => {
  const dbKey = req.query.dbKey;

  try {
    const resources = await listResources(dbKey);
    res.json(resources);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /resource
 * Reads data from a resource.
 * Expects query parameter "uri" and optional "dbKey".
 */
app.get("/resource", async (req, res, next) => {
  const uri = req.query.uri;
  const dbKey = req.query.dbKey;
  if (!uri) {
    const error = new Error("Parameter 'uri' is required");
    error.statusCode = 400;
    return next(error);
  }

  try {
    const data = await readResource(uri, dbKey);
    res.type("text/plain").send(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /tools
 * Lists available MSSQL tools.
 */
app.get("/tools", (_req, res, next) => {
  try {
    const tools = listTools();
    res.json(tools);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /databases
 * Lists all configured databases in the system.
 */
app.get("/databases", async (_req, res, next) => {
  try {
    const result = await listDatabases();
    if (result.isError) {
      const error = new Error(JSON.parse(result.content[0].text).error);
      error.statusCode = 500;
      return next(error);
    }
    const parsedResult = JSON.parse(result.content[0].text);
    res.json(parsedResult);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /execute-sql
 * Executes an SQL query.
 * Expects a JSON body with "query" and optional "dbKey" properties.
 */
app.post("/execute-sql", async (req, res, next) => {
  const { query, dbKey } = req.body;
  if (!query) {
    const error = new Error("Parameter 'query' is required");
    error.statusCode = 400;
    return next(error);
  }

  try {
    const result = await executeSql(query, dbKey);
    if (result.isError) {
      const error = new Error(JSON.parse(result.content[0].text).error);
      error.statusCode = 500;
      return next(error);
    }
    const parsedResult = JSON.parse(result.content[0].text);
    res.json(parsedResult);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /get-table-schema
 * Retrieves schema information for a specified table.
 * Expects a JSON body with "table" and optional "dbKey" properties.
 */
app.post("/get-table-schema", async (req, res, next) => {
  const { table, dbKey } = req.body;
  if (!table) {
    const error = new Error("Parameter 'table' is required");
    error.statusCode = 400;
    return next(error);
  }

  try {
    const result = await getTableSchema(table, dbKey);
    if (result.isError) {
      const error = new Error(JSON.parse(result.content[0].text).error);
      error.statusCode = 500;
      return next(error);
    }
    const parsedResult = JSON.parse(result.content[0].text);
    res.json(parsedResult);
  } catch (error) {
    next(error);
  }
});

// Apply error handling middleware after all routes
app.use(errorHandler);

module.exports = {
  app,
  /**
   * Starts the Express server on the specified port.
   */
  startServer: () => {
    const availableDatabases = Object.keys(dbConfigs);
    const defaultDatabase = availableDatabases[0] || "maindb";

    app.listen(port, () => {
      console.log(`MSSQL MCP server is running on port ${port}`);
      console.log(`Available endpoints:`);
      console.log(`- GET /resources - List all tables as resources`);
      console.log(`- GET /resource?uri=<uri> - Read resource data`);
      console.log(`- GET /tools - List available tools`);
      console.log(`- GET /databases - List all configured databases`);
      console.log(`- POST /execute-sql - Execute SQL query`);
      console.log(`- POST /get-table-schema - Get table schema`);
      console.log(`\nConfigured databases: ${availableDatabases.join(", ")}`);
      console.log(`Default database: ${defaultDatabase}`);
    });
  },
};
