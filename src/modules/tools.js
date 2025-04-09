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

// TODO: Use READ ONLY TRANSACTION for executeSql and getTableSchema

/**
 * Executes an SQL query and formats the results.
 * @param {string} query - The SQL query to execute.
 * @returns {Promise<Object>} Response object with content array and isError flag.
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
      const resultData = {
        tables,
        database: config.database,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(resultData, null, 2) }],
        isError: false,
      };
    } else if (upperQuery.startsWith("SELECT")) {
      const result = await pool.request().query(query);
      return {
        content: [
          { type: "text", text: JSON.stringify(result.recordset, null, 2) },
        ],
        isError: false,
      };
    } else {
      const result = await pool.request().query(query);
      const resultData = {
        message: "Query executed successfully",
        rowsAffected: result.rowsAffected[0],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(resultData, null, 2) }],
        isError: false,
      };
    }
  } catch (error) {
    console.error(`Error executing SQL query: ${error.message}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message }, null, 2),
        },
      ],
      isError: true,
    };
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

/**
 * Retrieves schema information for a specified table.
 * @param {string} table - The name of the table to get schema for.
 * @returns {Promise<Object>} Response object with content array and isError flag.
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

    return {
      content: [
        { type: "text", text: JSON.stringify(result.recordset, null, 2) },
      ],
      isError: false,
    };
  } catch (error) {
    console.error(
      `Error retrieving schema for table '${table}': ${error.message}`
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message }, null, 2),
        },
      ],
      isError: true,
    };
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
