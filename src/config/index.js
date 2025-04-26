const { z } = require("zod");

/**
 * Schema for database connection configuration validation
 * Used for both single and multi-database configurations
 */
const dbConnectionSchema = z.object({
  server: z.string().min(1, { message: "Server name is required" }),
  port: z.number().optional(),
  user: z.string().min(1, { message: "Username is required" }),
  password: z.string().min(1, { message: "Password is required" }),
  database: z.string().min(1, { message: "Database name is required" }),
  options: z.object({
    encrypt: z.boolean(),
    trustServerCertificate: z.boolean(),
  }),
  connectionTimeout: z.number().optional().default(30000),
  requestTimeout: z.number().optional().default(30000),
  pool: z
    .object({
      max: z.number().optional().default(10),
      min: z.number().optional().default(0),
      idleTimeoutMillis: z.number().optional().default(30000),
    })
    .optional()
    .default({
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    }),
});

/**
 * Parses and validates the input using the provided schema
 * @param {Object} schema - Zod schema to use for validation
 * @param {any} data - Data to validate
 * @returns {Object} Parsed and validated data
 * @throws {Error} If validation fails
 */
function validate(schema, data) {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error.errors && error.errors.length > 0) {
      const messages = error.errors
        .map((err) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");
      throw new Error(`[config] Validation failed: ${messages}`);
    }
    throw new Error("[config] Validation failed");
  }
}

/**
 * Detects if we're running in multi-database or single-database mode
 * Returns appropriate configuration mode string
 */
function detectConfigMode() {
  const hasMultiDb = Boolean(
    process.env.MSSQL_MAINDB_SERVER && process.env.MSSQL_REPORTINGDB_SERVER
  );
  const hasSingleDb = Boolean(
    process.env.MSSQL_SERVER || process.env.MSSQL_DATABASE
  );

  if (hasMultiDb) {
    return "multi";
  } else if (hasSingleDb) {
    return "single";
  } else {
    throw new Error(
      "[config] No valid database configuration found. Please set either MSSQL_* variables for single-database mode or MSSQL_<DBNAME>_* variables for multi-database mode."
    );
  }
}

/**
 * Loads single database configuration from environment variables
 * @returns {Object} Validated configuration object
 */
function loadSingleDatabaseConfig() {
  const config = {
    server: process.env.MSSQL_SERVER || "localhost",
    port: process.env.MSSQL_PORT
      ? parseInt(process.env.MSSQL_PORT, 10)
      : undefined,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    database: process.env.MSSQL_DATABASE,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === "true",
      trustServerCertificate:
        process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== "false",
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };

  if (!config.user || !config.password || !config.database) {
    throw new Error(
      "[config] Missing required database credentials. Please set MSSQL_USER, MSSQL_PASSWORD, and MSSQL_DATABASE."
    );
  }

  return { maindb: validate(dbConnectionSchema, config) };
}

/**
 * Loads multi-database configurations from environment variables
 * @returns {Object} Object with database keys as keys and validated configurations as values
 */
function loadMultiDatabaseConfigs() {
  const dbConfigs = {};
  const errors = [];

  // Find all database configurations (any env var ending with _DATABASE)
  for (const [envKey, value] of Object.entries(process.env)) {
    const match = envKey.match(/^MSSQL_(.+)_DATABASE$/);
    if (match) {
      try {
        const dbKey = match[1].toLowerCase();
        const prefix = `MSSQL_${match[1]}_`;

        const server =
          process.env[`${prefix}SERVER`] ||
          process.env.MSSQL_SERVER ||
          "localhost";
        const port = process.env[`${prefix}PORT`]
          ? parseInt(process.env[`${prefix}PORT`], 10)
          : undefined;
        const user = process.env[`${prefix}USER`] || process.env.MSSQL_USER;
        const password =
          process.env[`${prefix}PASSWORD`] || process.env.MSSQL_PASSWORD;
        const database = value;
        const encrypt =
          (process.env[`${prefix}ENCRYPT`] || process.env.MSSQL_ENCRYPT) ===
          "true";
        const trustServerCertificate =
          (process.env[`${prefix}TRUST_SERVER_CERTIFICATE`] ||
            process.env.MSSQL_TRUST_SERVER_CERTIFICATE) !== "false";

        if (user && password && database) {
          const config = {
            server,
            user,
            password,
            database,
            options: {
              encrypt,
              trustServerCertificate,
            },
            connectionTimeout: 30000,
            requestTimeout: 30000,
            pool: {
              max: 10,
              min: 0,
              idleTimeoutMillis: 30000,
            },
          };

          if (port) config.port = port;
          dbConfigs[dbKey] = validate(dbConnectionSchema, config);
        } else {
          errors.push(
            `[config] Incomplete configuration for database ${dbKey}. Missing user, password, or database name.`
          );
        }
      } catch (error) {
        errors.push(`[config] ${error.message}`);
      }
    }
  }

  if (Object.keys(dbConfigs).length === 0) {
    throw new Error(
      `[config] No valid database configurations found. ${errors.join(" ")}`
    );
  }

  if (errors.length > 0) {
    console.warn("Configuration warnings:", errors.join("; "));
  }

  return dbConfigs;
}

/**
 * Main configuration loader - auto-detects mode and loads appropriate configurations
 */
function loadDatabaseConfigs() {
  const mode = detectConfigMode();

  if (mode === "multi") {
    return loadMultiDatabaseConfigs();
  } else {
    return loadSingleDatabaseConfig();
  }
}

// Load the configurations once when the module is imported
const dbConfigs = loadDatabaseConfigs();
const connectionStatus = {};

// Initialize connection status for all databases
Object.keys(dbConfigs).forEach((dbKey) => {
  connectionStatus[dbKey] = {
    lastConnected: null,
    lastError: null,
    status: "initialized",
  };
});

/**
 * Returns the config for the given dbKey (e.g., 'maindb', 'reportingdb', etc.).
 * If dbKey is not provided, falls back to the first available config, usually 'maindb'.
 * Throws if not found.
 */
function getDbConfig(dbKey) {
  if (dbKey) {
    const key = dbKey.toLowerCase();
    if (!dbConfigs[key]) {
      throw new Error(
        `[config] Invalid dbKey '${dbKey}'. Available: ${Object.keys(dbConfigs).join(", ")}`
      );
    }
    return dbConfigs[key];
  }

  // Fallback: return the first available config (usually maindb)
  const firstKey = Object.keys(dbConfigs)[0];
  return dbConfigs[firstKey];
}

/**
 * Get database connection status
 * @returns {Object} Connection status for all databases
 */
function getConnectionStatus() {
  return connectionStatus;
}

/**
 * Updates the connection status for a specific database
 */
function updateConnectionStatus(dbKey, status, error = null) {
  if (connectionStatus[dbKey]) {
    connectionStatus[dbKey] = {
      lastConnected:
        status === "connected"
          ? new Date().toISOString()
          : connectionStatus[dbKey].lastConnected,
      lastError: error ? error.message : connectionStatus[dbKey].lastError,
      status: status,
    };
  }
}

module.exports = {
  getDbConfig,
  dbConfigs,
  connectionStatus,
  getConnectionStatus,
  updateConnectionStatus,
  validate,
  dbConnectionSchema,
  detectConfigMode,
};
