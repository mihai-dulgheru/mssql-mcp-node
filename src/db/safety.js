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
 * Best-effort rollback of the read wrapper transaction.
 *
 * EABORT means the server already rolled back (XACT_ABORT, severe error) and the
 * driver has released the connection - nothing to do. Any other failure (e.g. the
 * user's SQL contained an explicit COMMIT, or a request was still in progress) is
 * logged rather than swallowed: a rollback that fails for the wrong reason can
 * leave the connection borrowed from the pool forever (issue #8).
 */
async function rollbackQuietly(transaction) {
  try {
    await transaction.rollback();
  } catch (err) {
    if (err?.code === "EABORT") return;
    console.error(
      `[safety] rollback failed (${err?.code || "unknown"}): ${err?.message}`
    );
  }
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
    await rollbackQuietly(transaction);
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
 *
 * Event contract (mssql stream mode): `error` may fire several times and fires
 * while the request still holds the transaction's connection; `done` is always
 * the last event and fires only after the driver has released it. We therefore
 * settle on `done` - settling on `error` made the rollback in `finally` fail
 * with EREQINPROG and leaked the transaction + pool connection (issue #8).
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
      let firstError = null;

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
        // Errors caused by our own truncation cancel are expected: ECANCEL once
        // the server acks the attention, or ETIMEOUT if it never does (tedious
        // then drops the connection; rollback logs EINVALIDSTATE). A request
        // timeout cannot surface here - tedious clears that timer on the first
        // packet, and `canceled` is only set from a row event. Any other error
        // (SQL error, abort-signal cancel) fails the read.
        if (canceled && (err?.code === "ECANCEL" || err?.code === "ETIMEOUT")) {
          return;
        }
        if (!firstError) firstError = err;
      });
      request.on("done", () => {
        if (firstError) reject(firstError);
        else resolve({ rows, totalSeen, truncated });
      });

      try {
        request.query(query);
      } catch (err) {
        reject(err);
      }
    });
  } finally {
    await rollbackQuietly(transaction);
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
