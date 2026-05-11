const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead } = require("../db/safety");
const { dbKeyShape, paginationShape } = require("../validation");
const { LIST_TABLES_SQL, COUNT_TABLES_SQL } = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  tables: z.array(z.object({ schema: z.string(), name: z.string() })),
};

async function handler({ dbKey, limit, offset }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const pool = await getPool(actualKey, config);
  const { tables, total } = await runRead(
    pool,
    async (request) => {
      request.input("limit", sql.Int, limit);
      request.input("offset", sql.Int, offset);
      const pageResult = await request.query(LIST_TABLES_SQL);
      const countResult = await request.query(COUNT_TABLES_SQL);
      return {
        tables: pageResult.recordset,
        total: countResult.recordset[0].total,
      };
    },
    { signal: extra?.signal }
  );
  const structured = {
    db: config.database,
    dbKey: actualKey,
    total,
    offset,
    limit,
    tables,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "list_tables",
  config: {
    title: "List Tables",
    description:
      "Paginated list of base tables. Use `offset`/`limit` to walk the catalog. Returns total row count for the caller to size pagination.",
    inputSchema: { ...dbKeyShape, ...paginationShape },
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
