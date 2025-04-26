const sql = require("mssql");
const { getDbConfig } = require("../config/dbConfig");
const { resourceUriSchema, dbKeySchema, validate } = require("../validation");

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
    let pool;
    try {
      pool = await sql.connect(config);
      const result = await pool.request().query(`
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
      `);

      // Include database name in resource description for better clarity
      const resources = result.recordset.map((row) => ({
        uri: `mssql://${row.TABLE_NAME}/data`,
        name: `Table: ${row.TABLE_NAME}`,
        description: `Data in table: ${row.TABLE_NAME} (DB: ${config.database})`,
        mimeType: "text/plain",
      }));
      return resources;
    } catch (error) {
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
 * @param {string} uri - The resource URI (format: "mssql://<table>/data").
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
    const table = parts[0];
    let pool;
    try {
      pool = await sql.connect(config);

      // Using a transaction to ensure consistent read
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

      const queryRequest = new sql.Request(transaction);
      queryRequest.input("tableName", sql.VarChar, table);

      // Safely construct the query using escaped table name
      const escapedTableName = `[${table.replace(/]/g, "]]")}]`;
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
          if (value === null || value === undefined) return "";
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
