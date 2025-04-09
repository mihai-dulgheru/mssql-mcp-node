const sql = require("mssql");
const { getDbConfig } = require("../config/dbConfig");

/**
 * Lists available SQL Server tools.
 * @returns {Array<Object>} Array of tool objects.
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
 * Executes a tool by name with the provided arguments.
 * @param {string} name - The tool name.
 * @param {Object} argumentsObj - The arguments for the tool.
 * @returns {Promise<Array<Object>>} Array of text content objects.
 */
async function callTool(name, argumentsObj) {
  const config = getDbConfig();
  console.log(
    `Calling tool: ${name} with arguments: ${JSON.stringify(argumentsObj)}`
  );
  let pool;
  try {
    pool = await sql.connect(config);

    if (name === "execute_sql") {
      const query = argumentsObj.query;
      if (!query) {
        throw new Error("Query is required");
      }
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
    } else if (name === "get_table_schema") {
      const table = argumentsObj.table;
      if (!table) {
        throw new Error("Table name is required");
      }
      const query = `
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${table}'
      `;
      const result = await pool.request().query(query);
      const csvRows = [];
      csvRows.push("COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH");
      result.recordset.forEach((row) => {
        csvRows.push(
          `${row.COLUMN_NAME},${row.DATA_TYPE},${
            row.CHARACTER_MAXIMUM_LENGTH || ""
          }`
        );
      });
      return [{ type: "text", text: csvRows.join("\n") }];
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error executing tool '${name}': ${error.message}`);
    return [{ type: "text", text: `Error executing query: ${error.message}` }];
  } finally {
    if (pool) {
      pool.close();
    }
  }
}

module.exports = {
  listTools,
  callTool,
};
