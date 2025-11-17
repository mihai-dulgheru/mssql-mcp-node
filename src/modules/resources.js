const sql = require("mssql");
const { getDbConfig, getDefaultDbKey } = require("../config/dbConfig");
const { resourceUriSchema, dbKeySchema, validate } = require("../validation");
const { updateConnectionStatus } = require("../config");

/**
 * Lists available tables (resources) from the SQL Server database.
 * Accepts optional dbKey for multi-database support.
 * @param {string} [dbKey] - Optional database key.
 * @returns {Promise<Array<Object>>} An array of resource objects.
 */
async function listResources(dbKey) {
  try {
    // Validate dbKey if provided, but don't require it
    if (dbKey) {
      validate(dbKeySchema, { dbKey });
    }

    const config = getDbConfig(dbKey);
    const actualDbKey = dbKey || getDefaultDbKey();
    let pool;
    try {
      pool = new sql.ConnectionPool(config);
      await pool.connect();
      updateConnectionStatus(actualDbKey, "connected");
      const result = await pool.request().query(`
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
      `);

      // Include database name in resource description for better clarity
      const resources = result.recordset.map((row) => ({
        uri: `mssql://${row.TABLE_SCHEMA}.${row.TABLE_NAME}/data`,
        name: `Table: ${row.TABLE_SCHEMA}.${row.TABLE_NAME}`,
        description: `Data in table: ${row.TABLE_SCHEMA}.${row.TABLE_NAME} (DB: ${config.database})`,
        mimeType: "text/plain",
      }));
      return resources;
    } catch (error) {
      const actualDbKey =
        dbKey || Object.keys(require("../config/dbConfig").dbConfigs)[0];
      updateConnectionStatus(actualDbKey, "error", error);
      console.error(`Failed to list resources: ${error.message}`);
      return [];
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  } catch (validationError) {
    console.error(`Validation error: ${validationError.message}`);
    throw new Error(`Invalid database key: ${validationError.message}`);
  }
}

/**
 * Reads data from a specified table.
 * Accepts optional dbKey for multi-database support.
 * @param {string} uri - The resource URI (format: "mssql://<table>/data" or "mssql://<schema>.<table>/data").
 * @param {string} [dbKey] - Optional database key.
 * @returns {Promise<string>} CSV-formatted data including headers.
 * @throws {Error} If the URI is invalid or the query fails.
 */
async function readResource(uri, dbKey) {
  try {
    const validUri = validate(resourceUriSchema, uri);

    // Validate dbKey if provided, but don't require it
    if (dbKey) {
      validate(dbKeySchema, { dbKey });
    }

    const config = getDbConfig(dbKey);
    if (!validUri.startsWith("mssql://")) {
      throw new Error(`Invalid URI scheme: ${validUri}`);
    }

    const parts = validUri.slice(8).split("/");
    const tablePart = parts[0];
    const actualDbKey = dbKey || getDefaultDbKey();
    let pool;
    try {
      pool = new sql.ConnectionPool(config);
      await pool.connect();
      updateConnectionStatus(actualDbKey, "connected");

      // Using a transaction to ensure consistent read
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

      const queryRequest = new sql.Request(transaction);
      // If schema is included (schema.table), split and escape both parts.
      let escapedTableName;
      if (tablePart.includes(".")) {
        const dotIndex = tablePart.indexOf(".");
        const schema = tablePart.substring(0, dotIndex);
        const table = tablePart.substring(dotIndex + 1);

        if (!schema || !table || table.includes(".")) {
          throw new Error(
            `Invalid table format: '${tablePart}'. Expected 'schema.table' format.`
          );
        }

        const escSchema = `[${schema.replace(/]/g, "]]")}]`;
        const escTable = `[${table.replace(/]/g, "]]")}]`;
        escapedTableName = `${escSchema}.${escTable}`;
      } else {
        const escTable = `[${tablePart.replace(/]/g, "]]")}]`;
        escapedTableName = escTable;
      }
      const query = `SELECT TOP 100 * FROM ${escapedTableName}`;

      const result = await queryRequest.query(query);
      await transaction.commit();

      const columns =
        result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [];
      const csvRows = [];

      // Add database information as a comment in the first row
      csvRows.push(`# Database: ${config.database}`);
      csvRows.push(columns.join(","));

      result.recordset.forEach((row) => {
        const rowValues = columns.map((col) => {
          // Handle special characters and null values for CSV format
          const value = row[col];
          if (value === null || value === undefined) {
            return "";
          }
          if (
            typeof value === "string" &&
            (value.includes(",") || value.includes('"') || value.includes("\n"))
          ) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        });
        csvRows.push(rowValues.join(","));
      });
      return csvRows.join("\n");
    } catch (error) {
      const actualDbKey = dbKey || getDefaultDbKey();
      updateConnectionStatus(actualDbKey, "error", error);
      console.error(
        `Database error reading resource ${validUri}: ${error.message}`
      );
      throw new Error(`Database error: ${error.message}`);
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  } catch (validationError) {
    console.error(`URI validation error: ${validationError.message}`);
    throw new Error(`Invalid resource URI: ${validationError.message}`);
  }
}

module.exports = {
  listResources,
  readResource,
};
