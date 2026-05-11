const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead, splitTableIdentifier } = require("../db/safety");
const { dbKeyShape, tableIdentifier } = require("../validation");
const { LIST_INDEXES_SQL } = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  table: z.string(),
  indexes: z.array(
    z.object({
      index: z.string(),
      type: z.string(),
      isUnique: z.boolean(),
      isPrimaryKey: z.boolean(),
      columns: z.string().nullable(),
    })
  ),
};

async function handler({ dbKey, table }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const { schema, table: tableName } = splitTableIdentifier(table);
  const pool = await getPool(actualKey, config);
  const recordset = await runRead(
    pool,
    async (request) => {
      request.input("tschema", sql.NVarChar, schema);
      request.input("tname", sql.NVarChar, tableName);
      const r = await request.query(LIST_INDEXES_SQL);
      return r.recordset;
    },
    { signal: extra?.signal }
  );
  const indexes = recordset.map((r) => ({
    index: r.index,
    type: r.type,
    isUnique: Boolean(r.isUnique),
    isPrimaryKey: Boolean(r.isPrimaryKey),
    columns: r.columns ?? null,
  }));
  const structured = {
    db: config.database,
    dbKey: actualKey,
    table,
    indexes,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "list_indexes",
  config: {
    title: "List Indexes",
    description:
      "Indexes on a specific table, including columns and uniqueness/primary-key flags. Use to inform JOIN and WHERE choices.",
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
