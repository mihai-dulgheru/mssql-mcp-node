const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead, splitTableIdentifier } = require("../db/safety");
const {
  dbKeyShape,
  tableIdentifier,
  paginationShape,
} = require("../validation");
const {
  LIST_FOREIGN_KEYS_SQL,
  COUNT_FOREIGN_KEYS_SQL,
} = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  table: z.string().nullable(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  foreignKeys: z.array(
    z.object({
      fk: z.string(),
      fromTable: z.string(),
      fromColumn: z.string(),
      toTable: z.string(),
      toColumn: z.string(),
    })
  ),
};

async function handler({ dbKey, table, limit, offset }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  let schema = null;
  let tableName = null;
  if (table) {
    ({ schema, table: tableName } = splitTableIdentifier(table));
  }
  const pool = await getPool(actualKey, config);
  const { foreignKeys, total } = await runRead(
    pool,
    async (request) => {
      request.input("tschema", sql.NVarChar, schema);
      request.input("tname", sql.NVarChar, tableName);
      request.input("limit", sql.Int, limit);
      request.input("offset", sql.Int, offset);
      const pageResult = await request.query(LIST_FOREIGN_KEYS_SQL);
      const countResult = await request.query(COUNT_FOREIGN_KEYS_SQL);
      return {
        foreignKeys: pageResult.recordset,
        total: countResult.recordset[0].total,
      };
    },
    { signal: extra?.signal }
  );
  const structured = {
    db: config.database,
    dbKey: actualKey,
    table: table || null,
    total,
    offset,
    limit,
    foreignKeys,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "list_foreign_keys",
  config: {
    title: "List Foreign Keys",
    description:
      "Foreign-key relationships in the database, optionally filtered to one table. Paginated - large schemas should narrow with `table` or walk pages.",
    inputSchema: {
      table: tableIdentifier.optional(),
      ...dbKeyShape,
      ...paginationShape,
    },
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
