const sqlLib = require("mssql");

function escapeIdentifier(name) {
  return `[${String(name).replace(/]/g, "]]")}]`;
}

function splitTableIdentifier(identifier) {
  if (!identifier.includes(".")) return { schema: null, table: identifier };
  const parts = identifier.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid table identifier '${identifier}'. Expected 'schema.table'.`
    );
  }
  return { schema: parts[0], table: parts[1] };
}

function quoteTable(identifier) {
  const { schema, table } = splitTableIdentifier(identifier);
  return schema
    ? `${escapeIdentifier(schema)}.${escapeIdentifier(table)}`
    : escapeIdentifier(table);
}

function writesEnabled(env = process.env) {
  return String(env.MSSQL_ENABLE_WRITES || "").toLowerCase() === "true";
}

function attachAbort(request, signal) {
  if (!signal) return;
  const cancel = () => {
    try {
      request.cancel();
    } catch {
      // ignore
    }
  };
  if (signal.aborted) {
    cancel();
    return;
  }
  signal.addEventListener("abort", cancel, { once: true });
}

/**
 * Run a read inside a transaction that is ALWAYS rolled back, even on success.
 *
 * This is a guardrail against accidental writes (a SELECT INTO, an INSERT smuggled
 * after a comment, etc.) - NOT a sandbox against an adversarial query. A user-supplied
 * `COMMIT TRANSACTION` mid-query will close the outer transaction, and any following
 * statements will run in autocommit mode and persist. Defense-in-depth requires a
 * least-privilege SQL login.
 */
async function runRead(pool, fn, { mssql = sqlLib, signal } = {}) {
  if (signal?.aborted) throw new Error("Request aborted");
  const transaction = new mssql.Transaction(pool);
  await transaction.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const request = new mssql.Request(transaction);
    attachAbort(request, signal);
    return await fn(request);
  } finally {
    try {
      await transaction.rollback();
    } catch {
      // ignore - rollback may fail if the transaction was implicitly closed
      // (e.g., user query contained an explicit COMMIT)
    }
  }
}

async function runWrite(
  pool,
  fn,
  { mssql = sqlLib, signal, writesEnabled: enabled = writesEnabled() } = {}
) {
  if (!enabled) {
    throw new Error(
      "writes are disabled. Set MSSQL_ENABLE_WRITES=true to enable execute_write_query."
    );
  }
  if (signal?.aborted) throw new Error("Request aborted");
  const request = new mssql.Request(pool);
  attachAbort(request, signal);
  return fn(request);
}

/**
 * Streaming read with a hard server-side row cutoff.
 *
 * Wraps the query in the same rollback-only transaction as `runRead`, but uses
 * mssql's stream mode and cancels the underlying request once we've seen
 * `offset + limit + 1` rows. This means a naive `SELECT * FROM Orders` against
 * a huge table cannot OOM the Node process - only `limit` rows are kept and the
 * request is cancelled as soon as we know more rows exist.
 *
 * Returns `{ rows, totalSeen, truncated }`. `truncated` is true iff there was at
 * least one row beyond `offset + limit` (which we cancelled before fetching the rest).
 */
async function streamRead(
  pool,
  query,
  { offset = 0, limit = 100, mssql = sqlLib, signal } = {}
) {
  if (signal?.aborted) throw new Error("Request aborted");
  const transaction = new mssql.Transaction(pool);
  await transaction.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const request = new mssql.Request(transaction);
    request.stream = true;
    attachAbort(request, signal);

    return await new Promise((resolve, reject) => {
      const rows = [];
      let totalSeen = 0;
      let truncated = false;
      let canceled = false;
      let settled = false;

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      request.on("row", (row) => {
        totalSeen++;
        if (totalSeen > offset && rows.length < limit) {
          rows.push(row);
        }
        if (totalSeen > offset + limit && !canceled) {
          truncated = true;
          canceled = true;
          try {
            request.cancel();
          } catch {
            // ignore
          }
        }
      });
      request.on("error", (err) => {
        if (canceled) {
          settle(resolve, { rows, totalSeen, truncated });
        } else {
          settle(reject, err);
        }
      });
      request.on("done", () => {
        settle(resolve, { rows, totalSeen, truncated });
      });

      try {
        request.query(query);
      } catch (err) {
        settle(reject, err);
      }
    });
  } finally {
    try {
      await transaction.rollback();
    } catch {
      // ignore
    }
  }
}

module.exports = {
  escapeIdentifier,
  splitTableIdentifier,
  quoteTable,
  writesEnabled,
  runRead,
  runWrite,
  streamRead,
};
