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
 * Uses a READ ONLY transaction for safe execution.
 * @param {string} query - The SQL query to execute.
 * @returns {Promise<Object>} Response object with content array and isError flag.
 */
async function executeSql(query) {
  if (!query) {
    throw new Error("Query is required");
  }

  const config = getDbConfig();
  let pool;
  let transaction;
  try {
    pool = await sql.connect(config);

    const upperQuery = query.trim().toUpperCase();
    if (upperQuery.startsWith("SELECT")) {
      transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

      const request = new sql.Request(transaction);

      if (upperQuery.includes("INFORMATION_SCHEMA.TABLES")) {
        const result = await request.query(query);
        const tables = result.recordset.map((row) => Object.values(row)[0]);
        const resultData = {
          tables,
          database: config.database,
        };
        await transaction.commit();
        return {
          content: [
            { type: "text", text: JSON.stringify(resultData, null, 2) },
          ],
          isError: false,
        };
      } else {
        const result = await request.query(query);
        await transaction.commit();
        return {
          content: [
            { type: "text", text: JSON.stringify(result.recordset, null, 2) },
          ],
          isError: false,
        };
      }
    } else {
      const request = pool.request();
      const result = await request.query(query);
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
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error(`Rollback error: ${rollbackError.message}`);
      }
    }
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
 * Uses a READ ONLY transaction for safe execution.
 * @param {string} table - The name of the table to get schema for.
 * @returns {Promise<Object>} Response object with content array and isError flag.
 */
async function getTableSchema(table) {
  if (!table) {
    throw new Error("Table name is required");
  }

  const config = getDbConfig();
  let pool;
  let transaction;
  try {
    pool = await sql.connect(config);

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    const request = new sql.Request(transaction);
    const query = `
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `;
    const result = await request.query(query);
    await transaction.commit();

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
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error(`Rollback error: ${rollbackError.message}`);
      }
    }
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
