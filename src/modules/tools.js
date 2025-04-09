const sql = require("mssql");
const { getDbConfig } = require("../config/dbConfig");

/**
 * Lists available SQL Server tools.
 * @returns {Array<Object>} An array of tool objects.
 */
function listTools() {
  return [
    {
      name: "execute_sql",
      description: "Execute an SQL query on the SQL Server",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The SQL query to execute",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_table_schema",
      description: "Retrieve the schema of a specified table",
      inputSchema: {
        type: "object",
        properties: {
          table: {
            type: "string",
            description: "The name of the table",
          },
        },
        required: ["table"],
      },
    },
  ];
}

/**
 * Executes an SQL query and formats the results.
 * @param {string} query - The SQL query to execute.
 * @returns {Promise<Array<Object>>} Array of text content objects.
 */
async function executeSql(query) {
  if (!query) {
    throw new Error("Query is required");
  }

  const config = getDbConfig();
  let pool;
  try {
    pool = await sql.connect(config);
    const upperQuery = query.trim().toUpperCase();

    if (
      upperQuery.startsWith("SELECT") &&
      upperQuery.includes("INFORMATION_SCHEMA.TABLES")
    ) {
      const result = await pool.request().query(query);
      const tables = result.recordset.map((row) => Object.values(row)[0]);
      const csvResult = `Tables_in_${config.database}\n${tables.join("\n")}`;
      return [{ type: "text", text: csvResult }];
    } else if (upperQuery.startsWith("SELECT")) {
      const result = await pool.request().query(query);
      const columns =
        result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [];
      const rows = result.recordset.map((row) =>
        columns.map((col) => row[col]).join(",")
      );
      const csvResult = [columns.join(","), ...rows].join("\n");
      return [{ type: "text", text: csvResult }];
    } else {
      const result = await pool.request().query(query);
      const affectedRows = result.rowsAffected[0];
      return [
        {
          type: "text",
          text: `Query executed successfully. Rows affected: ${affectedRows}`,
        },
      ];
    }
  } catch (error) {
    console.error(`Error executing SQL query: ${error.message}`);
    throw new Error(`Error executing query: ${error.message}`);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

/**
 * Retrieves schema information for a specified table.
 * @param {string} table - The name of the table to get schema for.
 * @returns {Promise<Array<Object>>} Array of text content objects with schema info in CSV format.
 */
async function getTableSchema(table) {
  if (!table) {
    throw new Error("Table name is required");
  }

  const config = getDbConfig();
  let pool;
  try {
    pool = await sql.connect(config);
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `;
    const result = await pool.request().query(query);

    if (result.recordset.length === 0) {
      throw new Error(`Table '${table}' not found or has no columns`);
    }

    const csvRows = [];
    csvRows.push("COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH");
    result.recordset.forEach((row) => {
      csvRows.push(
        `${row.COLUMN_NAME},${row.DATA_TYPE},${row.CHARACTER_MAXIMUM_LENGTH || ""}`
      );
    });
    return [{ type: "text", text: csvRows.join("\n") }];
  } catch (error) {
    console.error(
      `Error retrieving schema for table '${table}': ${error.message}`
    );
    throw new Error(`Error retrieving table schema: ${error.message}`);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

module.exports = {
  listTools,
  executeSql,
  getTableSchema,
};
