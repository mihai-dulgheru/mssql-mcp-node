const sql = require("mssql");
const {
  getDbConfig,
  dbConfigs,
  getConnectionStatus,
} = require("../config/dbConfig");
const {
  dbKeyTableSchema,
  dbKeyQuerySchema,
  validate,
} = require("../validation");

/**
 * Lists available SQL Server tools.
 * @returns {Array<Object>} An array of tool objects.
 */
function listTools() {
  return [
    {
      name: "execute_sql",
      description:
        "Execute an SQL query on the SQL Server (multi-database support)",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The SQL query to execute",
          },
          dbKey: {
            type: "string",
            description:
              "The database key to use (e.g., 'maindb', 'reportingdb', etc.). Optional in single-db mode.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_table_schema",
      description:
        "Retrieve the schema of a specified table (multi-database support)",
      inputSchema: {
        type: "object",
        properties: {
          table: {
            type: "string",
            description: "The name of the table",
          },
          dbKey: {
            type: "string",
            description:
              "The database key to use (e.g., 'maindb', 'reportingdb', etc.). Optional in single-db mode.",
          },
        },
        required: ["table"],
      },
    },
    {
      name: "list_databases",
      description: "List all configured databases in the application",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ];
}

/**
 * Determines if a SQL query is safe to execute
 * @param {string} query - The SQL query to check
 * @returns {boolean} - Whether the query is considered safe
 */
function isSafeQuery(query) {
  const upperQuery = query.trim().toUpperCase();
  const unsafePatterns = [
    /\s*DROP\s+/i,
    /\s*TRUNCATE\s+/i,
    /\s*ALTER\s+ROLE\s+/i,
    /\s*CREATE\s+LOGIN\s+/i,
    /\s*ALTER\s+LOGIN\s+/i,
    /\s*CREATE\s+USER\s+/i,
    /\s*ALTER\s+USER\s+/i,
    /\s*EXEC(\s+|\s*\()/i,
    /\s*EXECUTE(\s+|\s*\()/i,
    /\s*xp_cmdshell/i,
    /\s*sp_configure/i,
    /\s*RECONFIGURE\s*/i,
    /\s*GRANT\s+/i,
    /\s*REVOKE\s+/i,
    /\s*DENY\s+/i,
  ];

  // Check if the query contains unsafe patterns
  for (const pattern of unsafePatterns) {
    if (pattern.test(upperQuery)) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize query result to a consistent format
 * @param {Object} result - SQL query result
 * @param {Object} config - Database configuration used
 * @returns {Object} - Normalized result
 */
function normalizeQueryResult(result, config) {
  return {
    db: config.database,
    rowCount: result.recordset ? result.recordset.length : 0,
    recordset: result.recordset || [],
  };
}

/**
 * Executes an SQL query and formats the results.
 * Uses a READ ONLY transaction for safe execution.
 * @param {string} query - The SQL query to execute.
 * @param {string} [dbKey] - The database key to select the config.
 * @returns {Promise<Object>} Response object with content array and isError flag.
 */
async function executeSql(query, dbKey) {
  try {
    // Prepare input for validation - handle optional dbKey
    const validationInput = { query };
    if (dbKey) {
      validationInput.dbKey = dbKey;
    }

    // Validate query (and optional dbKey)
    let validSchema = dbKey
      ? validate(dbKeyQuerySchema, validationInput)
      : validate(dbKeyQuerySchema.partial({ dbKey: true }), validationInput);
    const { query: validQuery } = validSchema;

    // Validate query for safety
    if (!isSafeQuery(validQuery)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error:
                  "Query contains potentially unsafe operations and was blocked for security",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const config = getDbConfig(dbKey);
    let pool;
    let transaction;
    try {
      pool = await sql.connect(config);

      const upperQuery = validQuery.trim().toUpperCase();
      if (upperQuery.startsWith("SELECT")) {
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

        const request = new sql.Request(transaction);

        if (upperQuery.includes("INFORMATION_SCHEMA.TABLES")) {
          const result = await request.query(validQuery);
          const tables = result.recordset.map((row) => Object.values(row)[0]);
          const normalizedResult = {
            tables,
            db: config.database,
            rowCount: tables.length,
          };
          await transaction.commit();
          return {
            content: [
              { type: "text", text: JSON.stringify(normalizedResult, null, 2) },
            ],
            isError: false,
          };
        } else {
          const result = await request.query(validQuery);
          await transaction.commit();
          const normalizedResult = normalizeQueryResult(result, config);
          return {
            content: [
              { type: "text", text: JSON.stringify(normalizedResult, null, 2) },
            ],
            isError: false,
          };
        }
      } else {
        const request = pool.request();
        const result = await request.query(validQuery);
        const normalizedResult = {
          message: "Query executed successfully",
          db: config.database,
          rowsAffected: result.rowsAffected[0],
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(normalizedResult, null, 2) },
          ],
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
            text: JSON.stringify(
              {
                error: error.message,
                db: config.database,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  } catch (validationError) {
    console.error(`Validation error: ${validationError.message}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: validationError.message }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Retrieves schema information for a specified table.
 * Uses a READ ONLY transaction for safe execution.
 * @param {string} table - The name of the table to get schema for.
 * @param {string} [dbKey] - The database key to select the config.
 * @returns {Promise<Object>} Response object with content array and isError flag.
 */
async function getTableSchema(table, dbKey) {
  try {
    // Prepare input for validation - handle optional dbKey
    const validationInput = { table };
    if (dbKey) {
      validationInput.dbKey = dbKey;
    }

    // Validate table name (and optional dbKey)
    const validSchema = dbKey
      ? validate(dbKeyTableSchema, validationInput)
      : validate(dbKeyTableSchema.partial({ dbKey: true }), validationInput);

    const { table: validTable } = validSchema;

    const config = getDbConfig(dbKey);
    let pool;
    let transaction;
    try {
      pool = await sql.connect(config);

      transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

      // Use parameterized query to prevent SQL injection
      const request = new sql.Request(transaction);
      const query = `
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @tableName
        ORDER BY ORDINAL_POSITION
      `;

      // Add parameter
      request.input("tableName", sql.VarChar, validTable);

      const result = await request.query(query);
      await transaction.commit();

      if (result.recordset.length === 0) {
        throw new Error(`Table '${validTable}' not found or has no columns`);
      }

      const normalizedResult = {
        db: config.database,
        table: validTable,
        columns: result.recordset,
        rowCount: result.recordset.length,
      };

      return {
        content: [
          { type: "text", text: JSON.stringify(normalizedResult, null, 2) },
        ],
        isError: false,
      };
    } catch (error) {
      console.error(
        `Error retrieving schema for table '${validTable}': ${error.message}`
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
            text: JSON.stringify(
              {
                error: error.message,
                db: config.database,
                table: validTable,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    } finally {
      if (pool) {
        await pool.close();
      }
    }
  } catch (validationError) {
    console.error(`Validation error: ${validationError.message}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: validationError.message }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Lists all configured databases and their connection information.
 * Masks sensitive information like passwords.
 * @returns {Promise<Object>} Response object with database configurations.
 */
async function listDatabases() {
  try {
    // Create a sanitized copy of configurations (without passwords)
    const sanitizedConfigs = {};

    for (const [key, config] of Object.entries(dbConfigs)) {
      sanitizedConfigs[key] = {
        server: config.server,
        port: config.port || 1433,
        database: config.database,
        user: config.user,
        options: {
          encrypt: config.options.encrypt,
          trustServerCertificate: config.options.trustServerCertificate,
        },
      };
    }

    const statusInfo = getConnectionStatus();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              availableDatabases: Object.keys(dbConfigs),
              configurations: sanitizedConfigs,
              connectionStatus: statusInfo,
              count: Object.keys(dbConfigs).length,
              defaultDatabase: Object.keys(dbConfigs)[0],
            },
            null,
            2
          ),
        },
      ],
      isError: false,
    };
  } catch (error) {
    console.error(`Error listing databases: ${error.message}`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

module.exports = {
  listTools,
  executeSql,
  getTableSchema,
  listDatabases,
};
