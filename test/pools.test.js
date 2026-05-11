const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPool,
  closeAllPools,
  getConnectionStatus,
  _resetForTests,
} = require("../src/db/pools");

test.beforeEach(() => _resetForTests());
test.afterEach(async () => {
  await closeAllPools();
  _resetForTests();
});

function makeFakeMssql(opts = {}) {
  const events = { connects: 0, closes: 0 };
  function ConnectionPool(cfg) {
    this.cfg = cfg;
    this.connect = async () => {
      events.connects++;
      if (opts.failConnect) throw new Error("boom");
      this.connected = true;
      return this;
    };
    this.close = async () => {
      events.closes++;
      this.connected = false;
    };
    this.on = () => {};
  }
  return { ConnectionPool, events };
}

test("getPool returns the same pool for the same dbKey (single connect)", async () => {
  const { ConnectionPool, events } = makeFakeMssql();
  const p1 = await getPool("k", { server: "x" }, { ConnectionPool });
  const p2 = await getPool("k", { server: "x" }, { ConnectionPool });
  assert.equal(p1, p2);
  assert.equal(events.connects, 1);
});

test("getPool resolves concurrent calls to one pool", async () => {
  const { ConnectionPool, events } = makeFakeMssql();
  const [p1, p2] = await Promise.all([
    getPool("k", {}, { ConnectionPool }),
    getPool("k", {}, { ConnectionPool }),
  ]);
  assert.equal(p1, p2);
  assert.equal(events.connects, 1);
});

test("closeAllPools closes every cached pool", async () => {
  const { ConnectionPool, events } = makeFakeMssql();
  await getPool("a", {}, { ConnectionPool });
  await getPool("b", {}, { ConnectionPool });
  await closeAllPools();
  assert.equal(events.closes, 2);
});

test("getPool retries after a failed connect", async () => {
  const { ConnectionPool: FailingPool } = makeFakeMssql({ failConnect: true });
  await assert.rejects(() => getPool("z", {}, { ConnectionPool: FailingPool }));
  const status = getConnectionStatus();
  assert.equal(status.z.status, "error");

  const { ConnectionPool: GoodPool, events } = makeFakeMssql();
  await getPool("z", {}, { ConnectionPool: GoodPool });
  assert.equal(events.connects, 1, "second attempt should connect");
  assert.equal(getConnectionStatus().z.status, "connected");
});

test("getPool stores sanitized error (no raw message)", async () => {
  function PoolWithRichError() {
    this.connect = async () => {
      const err = new Error(
        "Login failed for user 'sa' with password='secret'"
      );
      err.name = "ConnectionError";
      err.code = "ELOGIN";
      throw err;
    };
    this.close = async () => {};
    this.on = () => {};
  }
  await assert.rejects(() =>
    getPool("leaky", {}, { ConnectionPool: PoolWithRichError })
  );
  const status = getConnectionStatus();
  assert.equal(status.leaky.lastError.name, "ConnectionError");
  assert.equal(status.leaky.lastError.code, "ELOGIN");
  // Critical: must NOT carry the raw message
  assert.equal(status.leaky.lastError.message, undefined);
  const serialized = JSON.stringify(status.leaky.lastError);
  assert.equal(/password=/.test(serialized), false);
  assert.equal(/secret/.test(serialized), false);
});
