const { z } = require("zod");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { streamRead } = require("../db/safety");
const { paginationShape, dbKeyShape, queryString } = require("../validation");

const inputShape = {
  query: queryString.describe(
    "Read-only SQL query. Wrapped in a rollback-only transaction, so any incidental writes are discarded. " +
      "Results are streamed and the underlying request is cancelled once `offset + limit` rows have been seen - " +
      "so even a naive `SELECT *` against a huge table will not load the full recordset into memory."
  ),
  ...dbKeyShape,
  ...paginationShape,
};

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  rowCount: z.number().int().nonnegative(),
  totalRowsSeen: z.number().int().nonnegative(),
  truncated: z.boolean(),
  recordset: z.array(z.record(z.unknown())),
};

async function handler({ query, dbKey, limit, offset }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const pool = await getPool(actualKey, config);
  const { rows, totalSeen, truncated } = await streamRead(pool, query, {
    offset,
    limit,
    signal: extra?.signal,
  });
  const structured = {
    db: config.database,
    dbKey: actualKey,
    rowCount: rows.length,
    totalRowsSeen: totalSeen,
    truncated,
    recordset: rows,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "execute_read_query",
  config: {
    title: "Execute Read Query",
    description:
      "Run a SELECT-style SQL query against a configured database. The query executes inside a transaction " +
      "that is ALWAYS rolled back, so accidental DML/DDL is non-durable (this is a guardrail, not a sandbox: " +
      "an explicit `COMMIT TRANSACTION` in the query string ends the wrapper and following writes will persist - " +
      "rely on a least-privilege SQL login for real isolation). Results are streamed; the server cancels the " +
      "underlying request once `offset + limit` rows have been seen, so `truncated:true` means more rows exist.",
    inputSchema: inputShape,
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
