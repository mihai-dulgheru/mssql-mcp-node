require("dotenv").config();
const { dbConfigSchema, validate } = require("../validation");

/**
 * Returns the database configuration.
 * @returns {Object} The MSSQL connection configuration.
 * @throws {Error} If required configuration variables are missing.
 */
function getDbConfig() {
  const server = process.env.MSSQL_SERVER || "localhost";
  const port = process.env.MSSQL_PORT
    ? parseInt(process.env.MSSQL_PORT, 10)
    : undefined;
  const user = process.env.MSSQL_USER;
  const password = process.env.MSSQL_PASSWORD;
  const database = process.env.MSSQL_DATABASE;
  const encrypt = process.env.MSSQL_ENCRYPT === "true";
  const trustServerCertificate =
    process.env.MSSQL_TRUST_SERVER_CERTIFICATE === "false";

  if (!user || !password || !database) {
    console.error(
      "Missing required database configuration. Environment variables MSSQL_USER, MSSQL_PASSWORD, and MSSQL_DATABASE are required."
    );
    throw new Error("Missing required database configuration");
  }

  const config = {
    server,
    user,
    password,
    database,
    options: {
      encrypt,
      trustServerCertificate,
    },
  };

  if (port) {
    config.port = port;
  }

  try {
    return validate(dbConfigSchema, config);
  } catch (error) {
    console.error(`Database configuration validation failed: ${error.message}`);
    throw error;
  }
}

module.exports = { getDbConfig };
