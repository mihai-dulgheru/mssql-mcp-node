const { z } = require("zod");

/**
 * Schema for SQL query validation
 */
const sqlQuerySchema = z.object({
  query: z
    .string()
    .min(1, { message: "SQL query cannot be empty" })
    .max(10000, { message: "SQL query is too long" }),
});

/**
 * Schema for table name validation
 */
const tableNameSchema = z.object({
  table: z
    .string()
    .min(1, { message: "Table name cannot be empty" })
    .max(128, { message: "Table name is too long" })
    .regex(/^[a-zA-Z0-9_]+$/, {
      message:
        "Table name can only contain alphanumeric characters and underscores",
    }),
});

/**
 * Schema for database resource URI validation
 */
const resourceUriSchema = z.string().regex(/^mssql:\/\/[a-zA-Z0-9_]+\/data$/, {
  message: "URI must match the pattern mssql://<table_name>/data",
});

/**
 * Schema for database configuration validation
 */
const dbConfigSchema = z.object({
  server: z.string().min(1, { message: "Server name is required" }),
  port: z.number().optional(),
  user: z.string().min(1, { message: "User name is required" }),
  password: z.string().min(1, { message: "Password is required" }),
  database: z.string().min(1, { message: "Database name is required" }),
  options: z.object({
    encrypt: z.boolean(),
    trustServerCertificate: z.boolean(),
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
      throw new Error(`Validation failed: ${messages}`);
    }
    throw new Error("Validation failed");
  }
}

module.exports = {
  sqlQuerySchema,
  tableNameSchema,
  resourceUriSchema,
  dbConfigSchema,
  validate,
};
