const { z } = require("zod");

const dbConnectionSchema = z.object({
  server: z.string().min(1),
  port: z.number().int().positive().optional(),
  user: z.string().min(1),
  password: z.string().min(1),
  database: z.string().min(1),
  options: z.object({
    encrypt: z.boolean(),
    trustServerCertificate: z.boolean(),
  }),
  connectionTimeout: z.number().int().positive().default(30000),
  requestTimeout: z.number().int().positive().default(30000),
  pool: z
    .object({
      max: z.number().int().positive().default(10),
      min: z.number().int().nonnegative().default(0),
      idleTimeoutMillis: z.number().int().nonnegative().default(30000),
    })
    .default({ max: 10, min: 0, idleTimeoutMillis: 30000 }),
});

function buildConfig({
  server,
  port,
  user,
  password,
  database,
  encrypt,
  trustServerCertificate,
}) {
  const cfg = {
    server: server || "localhost",
    user,
    password,
    database,
    options: {
      encrypt: encrypt === "true",
      trustServerCertificate: trustServerCertificate !== "false",
    },
  };
  if (port) cfg.port = Number.parseInt(port, 10);
  return dbConnectionSchema.parse(cfg);
}

function loadConfigsFromEnv(env = process.env) {
  const multiKeys = Object.keys(env).filter((k) =>
    /^MSSQL_(.+)_DATABASE$/.test(k)
  );

  if (multiKeys.length > 0) {
    const configs = {};
    const errors = [];
    for (const key of multiKeys) {
      const [, raw] = key.match(/^MSSQL_(.+)_DATABASE$/);
      const dbKey = raw.toLowerCase();
      const p = `MSSQL_${raw}_`;
      try {
        configs[dbKey] = buildConfig({
          server: env[`${p}SERVER`] || env.MSSQL_SERVER,
          port: env[`${p}PORT`],
          user: env[`${p}USER`] || env.MSSQL_USER,
          password: env[`${p}PASSWORD`] || env.MSSQL_PASSWORD,
          database: env[key],
          encrypt: env[`${p}ENCRYPT`] || env.MSSQL_ENCRYPT,
          trustServerCertificate:
            env[`${p}TRUST_SERVER_CERTIFICATE`] ||
            env.MSSQL_TRUST_SERVER_CERTIFICATE,
        });
      } catch (err) {
        errors.push(`${dbKey}: ${err.message}`);
      }
    }
    if (Object.keys(configs).length === 0) {
      throw new Error(
        `[config] No valid database configuration found. ${errors.join("; ")}`
      );
    }
    if (errors.length > 0) {
      console.warn(`[config] warnings: ${errors.join("; ")}`);
    }
    return { configs, mode: "multi" };
  }

  if (env.MSSQL_SERVER || env.MSSQL_DATABASE) {
    return {
      mode: "single",
      configs: {
        maindb: buildConfig({
          server: env.MSSQL_SERVER,
          port: env.MSSQL_PORT,
          user: env.MSSQL_USER,
          password: env.MSSQL_PASSWORD,
          database: env.MSSQL_DATABASE,
          encrypt: env.MSSQL_ENCRYPT,
          trustServerCertificate: env.MSSQL_TRUST_SERVER_CERTIFICATE,
        }),
      },
    };
  }

  throw new Error(
    "[config] No valid database configuration found. Set MSSQL_* for single mode or MSSQL_<NAME>_* for multi mode."
  );
}

let cached;

function getConfigs() {
  if (!cached) cached = loadConfigsFromEnv();
  return cached;
}

function getConfig(dbKey) {
  const { configs } = getConfigs();
  const key = dbKey ? String(dbKey).toLowerCase() : Object.keys(configs)[0];
  if (!configs[key]) {
    throw new Error(
      `[config] Invalid dbKey '${dbKey}'. Available: ${Object.keys(configs).join(", ")}`
    );
  }
  return { dbKey: key, config: configs[key] };
}

function getDefaultDbKey() {
  return Object.keys(getConfigs().configs)[0];
}

function listDbKeys() {
  return Object.keys(getConfigs().configs);
}

function _resetForTests() {
  cached = undefined;
}

module.exports = {
  loadConfigsFromEnv,
  getConfigs,
  getConfig,
  getDefaultDbKey,
  listDbKeys,
  _resetForTests,
};
