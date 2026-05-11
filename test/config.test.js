const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfigsFromEnv } = require("../src/config");

test("single-db mode loads from MSSQL_* variables", () => {
  const env = {
    MSSQL_SERVER: "s",
    MSSQL_USER: "u",
    MSSQL_PASSWORD: "p",
    MSSQL_DATABASE: "d",
    MSSQL_ENCRYPT: "true",
  };
  const { configs, mode } = loadConfigsFromEnv(env);
  assert.equal(mode, "single");
  assert.ok(configs.maindb);
  assert.equal(configs.maindb.server, "s");
  assert.equal(configs.maindb.options.encrypt, true);
  assert.equal(configs.maindb.options.trustServerCertificate, true);
});

test("trustServerCertificate honors MSSQL_TRUST_SERVER_CERTIFICATE=false", () => {
  const { configs } = loadConfigsFromEnv({
    MSSQL_SERVER: "s",
    MSSQL_USER: "u",
    MSSQL_PASSWORD: "p",
    MSSQL_DATABASE: "d",
    MSSQL_TRUST_SERVER_CERTIFICATE: "false",
  });
  assert.equal(configs.maindb.options.trustServerCertificate, false);
});

test("multi-db mode loads each MSSQL_<NAME>_DATABASE", () => {
  const env = {
    MSSQL_REPORTING_SERVER: "r",
    MSSQL_REPORTING_USER: "u",
    MSSQL_REPORTING_PASSWORD: "p",
    MSSQL_REPORTING_DATABASE: "rd",
    MSSQL_ANALYTICS_SERVER: "a",
    MSSQL_ANALYTICS_USER: "u",
    MSSQL_ANALYTICS_PASSWORD: "p",
    MSSQL_ANALYTICS_DATABASE: "ad",
  };
  const { configs, mode } = loadConfigsFromEnv(env);
  assert.equal(mode, "multi");
  assert.deepEqual(
    new Set(Object.keys(configs)),
    new Set(["reporting", "analytics"])
  );
  assert.equal(configs.reporting.database, "rd");
  assert.equal(configs.analytics.database, "ad");
});

test("multi-db keys are lowercased", () => {
  const env = {
    MSSQL_MAINDB_SERVER: "s",
    MSSQL_MAINDB_USER: "u",
    MSSQL_MAINDB_PASSWORD: "p",
    MSSQL_MAINDB_DATABASE: "d",
  };
  const { configs } = loadConfigsFromEnv(env);
  assert.ok(configs.maindb);
});

test("multi-db falls back to global creds when per-db creds missing", () => {
  const env = {
    MSSQL_USER: "u",
    MSSQL_PASSWORD: "p",
    MSSQL_SERVER: "s",
    MSSQL_FOO_DATABASE: "foo",
  };
  const { configs } = loadConfigsFromEnv(env);
  assert.equal(configs.foo.user, "u");
  assert.equal(configs.foo.server, "s");
});

test("throws when no config present", () => {
  assert.throws(
    () => loadConfigsFromEnv({}),
    /No valid database configuration/
  );
});

test("port is coerced to number", () => {
  const { configs } = loadConfigsFromEnv({
    MSSQL_SERVER: "s",
    MSSQL_USER: "u",
    MSSQL_PASSWORD: "p",
    MSSQL_DATABASE: "d",
    MSSQL_PORT: "1433",
  });
  assert.equal(configs.maindb.port, 1433);
});
