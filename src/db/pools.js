const sqlLib = require("mssql");

const pools = new Map();
const status = new Map();

function sanitizeError(error) {
  if (!error) return null;
  // Avoid leaking raw error.message - it can include connection-string fragments
  // or principal names. Keep only the well-known fields callers actually need.
  return {
    name: error.name || "Error",
    code: error.code || null,
  };
}

function setStatus(dbKey, state, error) {
  const prev = status.get(dbKey) || {
    status: "initialized",
    lastConnected: null,
    lastError: null,
  };
  status.set(dbKey, {
    status: state,
    lastConnected:
      state === "connected" ? new Date().toISOString() : prev.lastConnected,
    lastError: error ? sanitizeError(error) : prev.lastError,
  });
}

async function getPool(dbKey, config, driver = sqlLib) {
  const existing = pools.get(dbKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const pool = new driver.ConnectionPool(config);
      if (typeof pool.on === "function") {
        pool.on("error", (err) => setStatus(dbKey, "error", err));
      }
      await pool.connect();
      setStatus(dbKey, "connected");
      return pool;
    } catch (err) {
      pools.delete(dbKey);
      setStatus(dbKey, "error", err);
      throw err;
    }
  })();

  pools.set(dbKey, promise);
  return promise;
}

async function closeAllPools() {
  const entries = Array.from(pools.values());
  pools.clear();
  await Promise.allSettled(
    entries.map(async (p) => {
      try {
        const pool = await p;
        await pool.close();
      } catch {
        // ignore close errors
      }
    })
  );
}

function getConnectionStatus() {
  return Object.fromEntries(status.entries());
}

function _resetForTests() {
  pools.clear();
  status.clear();
}

module.exports = {
  getPool,
  closeAllPools,
  getConnectionStatus,
  _resetForTests,
};
