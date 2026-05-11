const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead } = require("../db/safety");
const { dbKeyShape, paginationShape } = require("../validation");
const {
  LIST_PROCEDURES_SQL,
  COUNT_PROCEDURES_SQL,
} = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  procedures: z.array(z.object({ schema: z.string(), name: z.string() })),
};

async function handler({ dbKey, limit, offset }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const pool = await getPool(actualKey, config);
  const { procedures, total } = await runRead(
    pool,
    async (request) => {
      request.input("limit", sql.Int, limit);
      request.input("offset", sql.Int, offset);
      const pageResult = await request.query(LIST_PROCEDURES_SQL);
      const countResult = await request.query(COUNT_PROCEDURES_SQL);
      return {
        procedures: pageResult.recordset,
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
    procedures,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "list_stored_procedures",
  config: {
    title: "List Stored Procedures",
    description: "Paginated list of stored procedures.",
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
