const { z } = require("zod");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runWrite, writesEnabled } = require("../db/safety");
const { dbKeyShape, queryString } = require("../validation");

const inputShape = {
  query: queryString.describe(
    "Mutating SQL (INSERT/UPDATE/DELETE/MERGE/DDL). Disabled unless MSSQL_ENABLE_WRITES=true."
  ),
  ...dbKeyShape,
};

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  rowsAffected: z.array(z.number().int().nonnegative()),
  message: z.string(),
};

async function handler({ query, dbKey }, extra) {
  if (!writesEnabled()) {
    throw new Error(
      "writes are disabled. Set MSSQL_ENABLE_WRITES=true to enable execute_write_query."
    );
  }
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const pool = await getPool(actualKey, config);
  const result = await runWrite(pool, async (request) => request.query(query), {
    signal: extra?.signal,
    writesEnabled: true,
  });
  const structured = {
    db: config.database,
    dbKey: actualKey,
    rowsAffected: result.rowsAffected || [],
    message: "Query executed successfully",
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "execute_write_query",
  config: {
    title: "Execute Write Query",
    description:
      "Run a mutating SQL statement. DISABLED unless MSSQL_ENABLE_WRITES=true. " +
      "There is no keyword denylist - the database user's grants are the source of truth. " +
      "Use a least-privilege account for the relevant `dbKey`.",
    inputSchema: inputShape,
    outputSchema: outputShape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  handler,
};
