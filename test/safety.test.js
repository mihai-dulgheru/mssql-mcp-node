const test = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeIdentifier,
  splitTableIdentifier,
  quoteTable,
  runRead,
  runWrite,
  streamRead,
  writesEnabled,
} = require("../src/db/safety");

test("escapeIdentifier quotes brackets safely", () => {
  assert.equal(escapeIdentifier("Users"), "[Users]");
  assert.equal(escapeIdentifier("Weird]Name"), "[Weird]]Name]");
});

test("splitTableIdentifier handles schema.table and bare table", () => {
  assert.deepEqual(splitTableIdentifier("dbo.Users"), {
    schema: "dbo",
    table: "Users",
  });
  assert.deepEqual(splitTableIdentifier("Users"), {
    schema: null,
    table: "Users",
  });
  assert.throws(() => splitTableIdentifier("a.b.c"));
  assert.throws(() => splitTableIdentifier(".x"));
  assert.throws(() => splitTableIdentifier("x."));
});

test("quoteTable produces bracketed schema.table", () => {
  assert.equal(quoteTable("dbo.Users"), "[dbo].[Users]");
  assert.equal(quoteTable("Users"), "[Users]");
  assert.equal(quoteTable("dbo.We]ird"), "[dbo].[We]]ird]");
});

test("writesEnabled reads MSSQL_ENABLE_WRITES", () => {
  assert.equal(writesEnabled({ MSSQL_ENABLE_WRITES: "true" }), true);
  assert.equal(writesEnabled({ MSSQL_ENABLE_WRITES: "TRUE" }), true);
  assert.equal(writesEnabled({ MSSQL_ENABLE_WRITES: "false" }), false);
  assert.equal(writesEnabled({}), false);
});

function fakeMssqlFactory(events) {
  return {
    ISOLATION_LEVEL: { READ_COMMITTED: 4 },
    Transaction: function Transaction(pool) {
      this.pool = pool;
      this.begin = async (lvl) => {
        events.push(["begin", lvl]);
      };
      this.commit = async () => {
        events.push(["commit"]);
      };
      this.rollback = async () => {
        events.push(["rollback"]);
      };
    },
    Request: function Request(target) {
      this.target = target;
      this.canceled = false;
      this.input = () => this;
      this.cancel = () => {
        this.canceled = true;
        events.push(["cancel"]);
      };
      this.query = async (sql) => {
        events.push(["query", sql]);
        return { recordset: [{ x: 1 }], rowsAffected: [1] };
      };
    },
  };
}

test("runRead always rolls back, never commits", async () => {
  const events = [];
  const mssql = fakeMssqlFactory(events);
  const result = await runRead(
    {},
    async (request) => request.query("SELECT 1"),
    { mssql }
  );
  assert.deepEqual(result.recordset, [{ x: 1 }]);
  assert.ok(
    events.some((e) => e[0] === "rollback"),
    "must rollback"
  );
  assert.ok(!events.some((e) => e[0] === "commit"), "must not commit");
});

test("runRead rolls back even on callback error", async () => {
  const events = [];
  const mssql = fakeMssqlFactory(events);
  await assert.rejects(
    () =>
      runRead(
        {},
        async () => {
          throw new Error("oops");
        },
        { mssql }
      ),
    /oops/
  );
  assert.ok(events.some((e) => e[0] === "rollback"));
});

test("runRead cancels request when AbortSignal fires", async () => {
  const events = [];
  const mssql = fakeMssqlFactory(events);
  const controller = new AbortController();
  const promise = runRead(
    {},
    async (request) => {
      controller.abort();
      // simulate cancel-driven failure path
      return request.query("SELECT 1");
    },
    { mssql, signal: controller.signal }
  );
  await promise;
  assert.ok(events.some((e) => e[0] === "cancel"));
});

test("runWrite throws when writes disabled", async () => {
  await assert.rejects(
    () =>
      runWrite({}, async () => {}, {
        mssql: fakeMssqlFactory([]),
        writesEnabled: false,
      }),
    /writes are disabled/i
  );
});

test("runWrite executes callback when writes enabled", async () => {
  const events = [];
  const mssql = fakeMssqlFactory(events);
  const result = await runWrite(
    {},
    async (request) => request.query("INSERT ..."),
    { mssql, writesEnabled: true }
  );
  assert.deepEqual(result.rowsAffected, [1]);
});

test("runRead rejects pre-aborted signal without beginning a transaction", async () => {
  const events = [];
  const mssql = fakeMssqlFactory(events);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      runRead({}, async () => "should not run", {
        mssql,
        signal: controller.signal,
      }),
    /Request aborted/
  );
  assert.equal(
    events.some((e) => e[0] === "begin"),
    false,
    "transaction must not begin if signal already aborted"
  );
});

test("runWrite rejects pre-aborted signal", async () => {
  const events = [];
  const mssql = fakeMssqlFactory(events);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      runWrite({}, async () => "should not run", {
        mssql,
        signal: controller.signal,
        writesEnabled: true,
      }),
    /Request aborted/
  );
});

// Mirrors the real driver's event ordering (mssql@11 lib/base/request.js +
// lib/tedious/request.js, see issue #8): in stream mode `error` may fire
// mid-stream while the request still holds the transaction's connection; the
// driver releases the connection and only THEN emits `done` (always last).
// Rolling back while the request is active fails with EREQINPROG.
function streamingMssqlFactory({
  rows,
  errorOnRowIndex = null,
  continueAfterError = false,
  cancelErrorCode = "ECANCEL",
  onQuery = null,
  events = [],
}) {
  const errorAt = new Set([].concat(errorOnRowIndex ?? []));
  let listeners = {};
  let canceled = false;
  let activeRequest = false;
  return {
    ISOLATION_LEVEL: { READ_COMMITTED: 4 },
    Transaction: function Transaction() {
      this.begin = async () => {
        events.push(["begin"]);
      };
      this.commit = async () => {
        events.push(["commit"]);
      };
      this.rollback = async () => {
        if (activeRequest) {
          events.push(["rollback-failed", "EREQINPROG"]);
          throw Object.assign(
            new Error(
              "Can't rollback transaction. There is a request in progress."
            ),
            { code: "EREQINPROG" }
          );
        }
        events.push(["rollback"]);
      };
    },
    Request: function Request() {
      this.stream = false;
      this.input = () => this;
      this.cancel = () => {
        canceled = true;
        events.push(["cancel"]);
      };
      this.on = (event, fn) => {
        listeners[event] = fn;
      };
      this.query = () => {
        // Real driver: base Request._query resets `canceled`, so a cancel()
        // issued before query() is dropped.
        canceled = false;
        activeRequest = true;
        events.push(["query"]);
        onQuery?.();
        process.nextTick(async () => {
          for (let i = 0; i < rows.length; i++) {
            if (canceled) break;
            if (errorAt.has(i)) {
              events.push(["error"]);
              listeners.error?.(new Error(`simulated stream error @${i}`));
              if (!continueAfterError) break;
            }
            listeners.row?.(rows[i]);
          }
          if (canceled) {
            // ECANCEL when the server acks the attention; ETIMEOUT when the
            // cancel timer expires first (tedious then drops the connection).
            events.push(["error", cancelErrorCode]);
            listeners.error?.(
              Object.assign(new Error("Canceled."), { code: cancelErrorCode })
            );
          }
          // Real driver: the request completes on a later tick, releases the
          // connection back to the transaction, then emits `done`.
          await new Promise((resolve) => setImmediate(resolve));
          activeRequest = false;
          events.push(["release"]);
          listeners.done?.({});
        });
      };
    },
  };
}

function eventNames(events) {
  return events.map((e) => e.join(":"));
}

test("streamRead returns first `limit` rows and reports truncated=true when more exist", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({ rows });
  const result = await streamRead({}, "SELECT * FROM t", {
    offset: 0,
    limit: 10,
    mssql,
  });
  assert.equal(result.rows.length, 10);
  assert.deepEqual(result.rows[0], { id: 1 });
  assert.deepEqual(result.rows[9], { id: 10 });
  assert.equal(result.truncated, true);
  assert.ok(
    result.totalSeen >= 11,
    "must have seen at least one row past the cap to know more exist"
  );
});

test("streamRead reports truncated=false when result fits within limit", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({ rows });
  const result = await streamRead({}, "SELECT * FROM t", {
    offset: 0,
    limit: 10,
    mssql,
  });
  assert.equal(result.rows.length, 5);
  assert.equal(result.truncated, false);
  assert.equal(result.totalSeen, 5);
});

test("streamRead honors offset", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({ rows });
  const result = await streamRead({}, "SELECT * FROM t", {
    offset: 3,
    limit: 4,
    mssql,
  });
  assert.deepEqual(
    result.rows.map((r) => r.id),
    [4, 5, 6, 7]
  );
});

// ── issue #8: streamRead must not roll back while the request is in progress ──

test("streamRead: SQL error mid-stream rejects only after `done`, and rollback succeeds (issue #8)", async () => {
  const events = [];
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({ rows, errorOnRowIndex: 2, events });
  await assert.rejects(
    () => streamRead({}, "SELECT nonexistent_column", { limit: 10, mssql }),
    /simulated stream error/
  );
  const names = eventNames(events);
  assert.ok(
    !names.includes("rollback-failed:EREQINPROG"),
    `rollback attempted while request in progress: ${names.join(" ")}`
  );
  assert.ok(names.includes("rollback"), `no successful rollback: ${names}`);
  assert.ok(
    names.indexOf("release") < names.indexOf("rollback"),
    `rollback must come after the driver released the request: ${names}`
  );
});

test("streamRead: truncation cancel rolls back only after `done`", async () => {
  const events = [];
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({ rows, events });
  const result = await streamRead({}, "SELECT * FROM t", { limit: 10, mssql });
  assert.equal(result.truncated, true);
  assert.equal(result.rows.length, 10);
  const names = eventNames(events);
  assert.ok(!names.includes("rollback-failed:EREQINPROG"), names.join(" "));
  assert.deepEqual(
    names.filter(
      (n) => n !== "begin" && n !== "query" && !n.startsWith("error")
    ),
    ["cancel", "release", "rollback"]
  );
});

test("streamRead: a SQL error seen before the truncation cancel is still surfaced", async () => {
  const events = [];
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({
    rows,
    errorOnRowIndex: 2,
    continueAfterError: true,
    events,
  });
  await assert.rejects(
    () => streamRead({}, "SELECT 1/0; SELECT * FROM t", { limit: 10, mssql }),
    /simulated stream error/
  );
  assert.ok(eventNames(events).includes("rollback"));
});

test("streamRead: an unrequested ECANCEL (abort signal) still rejects", async () => {
  const events = [];
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const controller = new AbortController();
  // Abort once the query is in flight (a cancel issued before query() would be
  // dropped by the real driver, which resets `canceled` inside _query).
  const mssql = streamingMssqlFactory({
    rows,
    events,
    onQuery: () => controller.abort(),
  });
  await assert.rejects(
    () =>
      streamRead({}, "SELECT * FROM t", {
        limit: 10,
        mssql,
        signal: controller.signal,
      }),
    /Canceled/
  );
  assert.ok(eventNames(events).includes("cancel"), "abort must cancel");
  assert.ok(eventNames(events).includes("rollback"));
});

test("streamRead: cancel-timeout (ETIMEOUT) after our own truncation cancel still returns the rows", async () => {
  const events = [];
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({
    rows,
    events,
    cancelErrorCode: "ETIMEOUT",
  });
  const result = await streamRead({}, "SELECT * FROM t", { limit: 10, mssql });
  assert.equal(result.truncated, true);
  assert.equal(result.rows.length, 10);
  assert.ok(eventNames(events).includes("rollback"));
});

test("streamRead: surfaces the first of several SQL errors", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const mssql = streamingMssqlFactory({
    rows,
    errorOnRowIndex: [1, 3],
    continueAfterError: true,
  });
  await assert.rejects(
    () => streamRead({}, "SELECT * FROM t", { limit: 10, mssql }),
    /simulated stream error @1$/
  );
});

// ── rollback failures must not be silently discarded ──

function rollbackFailingFactory(code) {
  const mssql = fakeMssqlFactory([]);
  mssql.Transaction = function Transaction() {
    this.begin = async () => {};
    this.rollback = async () => {
      throw Object.assign(new Error(`rollback failed ${code}`), { code });
    };
  };
  return mssql;
}

test("runRead logs a rollback failure to stderr instead of swallowing it", async (t) => {
  const err = t.mock.method(console, "error", () => {});
  const result = await runRead(
    {},
    async (request) => request.query("SELECT 1"),
    { mssql: rollbackFailingFactory("EREQUEST") }
  );
  assert.deepEqual(result.recordset, [{ x: 1 }], "result still returned");
  assert.equal(err.mock.callCount(), 1);
  assert.match(err.mock.calls[0].arguments[0], /rollback failed.*EREQUEST/);
});

test("runRead stays quiet when the server already aborted the transaction (EABORT)", async (t) => {
  const err = t.mock.method(console, "error", () => {});
  await runRead({}, async (request) => request.query("SELECT 1"), {
    mssql: rollbackFailingFactory("EABORT"),
  });
  assert.equal(err.mock.callCount(), 0);
});

// ── follow-ups to issue #8: begin() edge cases ──

// Transaction whose begin() rejects after the pool handed out a connection
// (connection.beginTransaction failed): rollback must still run to release it.
function beginFailingFactory(events) {
  const mssql = fakeMssqlFactory(events);
  mssql.Transaction = function Transaction() {
    this.begin = async () => {
      events.push(["begin"]);
      throw new Error("BEGIN TRAN failed");
    };
    this.rollback = async () => {
      events.push(["rollback"]);
    };
  };
  return mssql;
}

test("runRead: begin() failing after acquire still rolls back (releases the connection)", async () => {
  const events = [];
  await assert.rejects(
    () =>
      runRead({}, async () => "unreachable", {
        mssql: beginFailingFactory(events),
      }),
    /BEGIN TRAN failed/
  );
  assert.ok(eventNames(events).includes("rollback"), eventNames(events));
});

test("runRead: begin() on a never-connected real pool surfaces ENOTOPEN and logs nothing (ENOTBEGUN)", async (t) => {
  // Real driver, no database: acquire rejects before any connection is held,
  // so the finally's rollback reports ENOTBEGUN, which must stay silent.
  const err = t.mock.method(console, "error", () => {});
  const pool = new (require("mssql").ConnectionPool)({
    server: "127.0.0.1",
    user: "x",
    password: "x",
    database: "x",
  });
  await assert.rejects(
    () => runRead(pool, async (request) => request.query("SELECT 1")),
    (e) => e.code === "ENOTOPEN"
  );
  assert.equal(err.mock.callCount(), 0, "ENOTBEGUN holds nothing - no log");
});

// runRead/streamRead run synchronously up to `await transaction.begin()`, so an
// abort() issued right after the call lands while begin() is in flight - the
// window where a cancel() issued before query() is dropped by the real driver.
test("runRead: abort during begin() rejects without running the callback", async () => {
  const events = [];
  const controller = new AbortController();
  let ran = false;
  const pending = runRead(
    {},
    async () => {
      ran = true;
    },
    { mssql: fakeMssqlFactory(events), signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(() => pending, /Request aborted/);
  assert.equal(ran, false, "callback must not run after an abort");
  assert.deepEqual(eventNames(events), ["begin:4", "rollback"]);
});

test("streamRead: abort during begin() rejects instead of running the query", async () => {
  const events = [];
  const controller = new AbortController();
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
  const pending = streamRead({}, "SELECT * FROM t", {
    limit: 10,
    mssql: streamingMssqlFactory({ rows, events }),
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(() => pending, /Request aborted/);
  assert.deepEqual(eventNames(events), ["begin", "rollback"]);
});
