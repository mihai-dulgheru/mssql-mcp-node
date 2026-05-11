const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead, splitTableIdentifier } = require("../db/safety");
const { dbKeyShape, tableIdentifier } = require("../validation");
const {
  DESCRIBE_TABLE_SQL,
  DESCRIBE_TABLE_WITH_SCHEMA_SQL,
} = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  table: z.string(),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      maxLength: z.number().nullable(),
      nullable: z.string(),
      default: z.string().nullable(),
      position: z.number().int(),
    })
  ),
};

async function handler({ dbKey, table }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const { schema, table: tableName } = splitTableIdentifier(table);
  const pool = await getPool(actualKey, config);
  const columns = await runRead(
    pool,
    async (request) => {
      request.input("tname", sql.NVarChar, tableName);
      if (schema) request.input("tschema", sql.NVarChar, schema);
      const r = await request.query(
        schema ? DESCRIBE_TABLE_WITH_SCHEMA_SQL : DESCRIBE_TABLE_SQL
      );
      return r.recordset;
    },
    { signal: extra?.signal }
  );
  if (columns.length === 0) {
    throw new Error(`Table '${table}' not found or has no columns`);
  }
  const structured = {
    db: config.database,
    dbKey: actualKey,
    table,
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type,
      maxLength: c.maxLength ?? null,
      nullable: c.nullable,
      default: c.default ?? null,
      position: c.position,
    })),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "describe_table",
  config: {
    title: "Describe Table",
    description:
      "Column schema for a table. Accepts bare or `schema.table` identifiers (e.g. `dbo.Users`).",
    inputSchema: { table: tableIdentifier, ...dbKeyShape },
    outputSchema: outputShape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler,
};
