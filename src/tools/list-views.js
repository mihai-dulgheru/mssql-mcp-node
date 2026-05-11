const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead } = require("../db/safety");
const { dbKeyShape, paginationShape } = require("../validation");
const { LIST_VIEWS_SQL, COUNT_VIEWS_SQL } = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  views: z.array(z.object({ schema: z.string(), name: z.string() })),
};

async function handler({ dbKey, limit, offset }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const pool = await getPool(actualKey, config);
  const { views, total } = await runRead(
    pool,
    async (request) => {
      request.input("limit", sql.Int, limit);
      request.input("offset", sql.Int, offset);
      const pageResult = await request.query(LIST_VIEWS_SQL);
      const countResult = await request.query(COUNT_VIEWS_SQL);
      return {
        views: pageResult.recordset,
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
    views,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "list_views",
  config: {
    title: "List Views",
    description:
      "Paginated list of views. Use `offset`/`limit` to walk the catalog.",
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
