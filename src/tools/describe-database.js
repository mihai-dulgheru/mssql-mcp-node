const { z } = require("zod");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead } = require("../db/safety");
const { dbKeyShape } = require("../validation");
const { DESCRIBE_DATABASE_SQL } = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  tableCount: z.number().int().nonnegative(),
  viewCount: z.number().int().nonnegative(),
  procedureCount: z.number().int().nonnegative(),
  currentUser: z.string(),
};

async function handler({ dbKey }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const pool = await getPool(actualKey, config);
  const recordset = await runRead(
    pool,
    async (request) => {
      const r = await request.query(DESCRIBE_DATABASE_SQL);
      return r.recordset;
    },
    { signal: extra?.signal }
  );
  const row = recordset[0] || {};
  const structured = {
    db: config.database,
    dbKey: actualKey,
    tableCount: Number(row.tableCount || 0),
    viewCount: Number(row.viewCount || 0),
    procedureCount: Number(row.procedureCount || 0),
    currentUser: row.currentUser || "",
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "describe_database",
  config: {
    title: "Describe Database",
    description:
      "High-level summary of a configured database: object counts (tables/views/procs) and the current user.",
    inputSchema: dbKeyShape,
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
