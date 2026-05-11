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

function streamingMssqlFactory({ rows, errorOnRowIndex = null }) {
  let listeners = {};
  let canceled = false;
  return {
    ISOLATION_LEVEL: { READ_COMMITTED: 4 },
    Transaction: function Transaction() {
      this.begin = async () => {};
      this.commit = async () => {};
      this.rollback = async () => {};
    },
    Request: function Request() {
      this.stream = false;
      this.input = () => this;
      this.cancel = () => {
        canceled = true;
      };
      this.on = (event, fn) => {
        listeners[event] = fn;
      };
      this.query = () => {
        process.nextTick(async () => {
          try {
            for (let i = 0; i < rows.length; i++) {
              if (canceled) break;
              if (errorOnRowIndex !== null && i === errorOnRowIndex) {
                listeners.error?.(new Error("simulated stream error"));
                return;
              }
              listeners.row?.(rows[i]);
            }
            if (canceled) {
              listeners.error?.(
                Object.assign(new Error("cancelled"), { code: "ECANCEL" })
              );
            } else {
              listeners.done?.({});
            }
          } catch (err) {
            listeners.error?.(err);
          }
        });
      };
    },
  };
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
