const { z } = require("zod");
const { getConfigs } = require("../config");
const { getConnectionStatus } = require("../db/pools");

const outputShape = {
  defaultDatabase: z.string(),
  count: z.number().int().nonnegative(),
  mode: z.string(),
  databases: z.array(
    z.object({
      dbKey: z.string(),
      server: z.string(),
      port: z.number().int().optional(),
      database: z.string(),
      user: z.string(),
      encrypt: z.boolean(),
      trustServerCertificate: z.boolean(),
      status: z.string().optional(),
      lastConnected: z.string().nullable().optional(),
      lastError: z
        .object({
          name: z.string(),
          code: z.string().nullable(),
        })
        .nullable()
        .optional(),
    })
  ),
};

async function handler() {
  const { configs, mode } = getConfigs();
  const status = getConnectionStatus();
  const databases = Object.entries(configs).map(([dbKey, c]) => {
    const entry = {
      dbKey,
      server: c.server,
      database: c.database,
      user: c.user,
      encrypt: c.options.encrypt,
      trustServerCertificate: c.options.trustServerCertificate,
      ...(status[dbKey] || {}),
    };
    if (c.port !== undefined) entry.port = c.port;
    return entry;
  });
  const structured = {
    defaultDatabase: Object.keys(configs)[0],
    count: databases.length,
    mode,
    databases,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "list_databases",
  config: {
    title: "List Configured Databases",
    description:
      "Lists every database the server has credentials for, plus connection-pool status. Passwords are never returned.",
    inputSchema: {},
    outputSchema: outputShape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler,
};
