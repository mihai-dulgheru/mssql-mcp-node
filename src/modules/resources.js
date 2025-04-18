const sql = require("mssql");
const { getDbConfig } = require("../config/dbConfig");
const { resourceUriSchema, validate } = require("../validation");

/**
 * Lists available tables (resources) from the SQL Server database.
 * @returns {Promise<Array<Object>>} An array of resource objects.
 */
async function listResources() {
  const config = getDbConfig();
  let pool;
  try {
    pool = await sql.connect(config);
    const result = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);
    const resources = result.recordset.map((row) => ({
      uri: `mssql://${row.TABLE_NAME}/data`,
      name: `Table: ${row.TABLE_NAME}`,
      description: `Data in table: ${row.TABLE_NAME}`,
      mimeType: "text/plain",
    }));
    return resources;
  } catch (error) {
    console.error(`Failed to list resources: ${error.message}`);
    return [];
  } finally {
    if (pool) {
      pool.close();
    }
  }
}

/**
 * Reads data from a specified table.
 * @param {string} uri - The resource URI (format: "mssql://<table>/data").
 * @returns {Promise<string>} CSV-formatted data including headers.
 * @throws {Error} If the URI is invalid or the query fails.
 */
async function readResource(uri) {
  try {
    const validUri = validate(resourceUriSchema, uri);

    const config = getDbConfig();
    if (!validUri.startsWith("mssql://")) {
      throw new Error(`Invalid URI scheme: ${validUri}`);
    }

    const parts = validUri.slice(8).split("/");
    const table = parts[0];

    let pool;
    try {
      pool = await sql.connect(config);
      const query = `SELECT TOP 100 * FROM ${table}`;
      const result = await pool.request().query(query);
      const columns =
        result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [];
      const csvRows = [];
      csvRows.push(columns.join(","));
      result.recordset.forEach((row) => {
        const rowValues = columns.map((col) => row[col]);
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
        pool.close();
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
