const { ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { getConfig, listDbKeys } = require("./config");
const { getPool } = require("./db/pools");
const { runRead, quoteTable, splitTableIdentifier } = require("./db/safety");
const { DEFAULT_LIMIT } = require("./validation");

const URI_RE =
  /^mssql:\/\/([a-zA-Z0-9_]+)@([a-zA-Z0-9_#$@]+(?:\.[a-zA-Z0-9_#$@]+)?)\/data$/;

function parseUri(uri) {
  const m = URI_RE.exec(uri);
  if (!m) {
    throw new Error(
      `Invalid resource URI '${uri}'. Expected mssql://<dbKey>@<schema>.<table>/data`
    );
  }
  return { dbKey: m[1], tablePart: m[2] };
}

function toCsv(database, recordset) {
  if (recordset.length === 0) return `# Database: ${database}\n`;
  const columns = Object.keys(recordset[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [`# Database: ${database}`, columns.join(",")];
  for (const row of recordset)
    lines.push(columns.map((c) => escape(row[c])).join(","));
  return lines.join("\n");
}

async function listAllTables() {
  const resources = [];
  for (const dbKey of listDbKeys()) {
    let pool;
    let config;
    try {
      ({ config } = getConfig(dbKey));
      pool = await getPool(dbKey, config);
    } catch {
      continue;
    }
    let tables = [];
    try {
      tables = await runRead(pool, async (request) => {
        const r = await request.query(`
          SELECT TOP 500 TABLE_SCHEMA AS [schema], TABLE_NAME AS [name]
          FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `);
        return r.recordset;
      });
    } catch {
      continue;
    }
    for (const row of tables) {
      resources.push({
        uri: `mssql://${dbKey}@${row.schema}.${row.name}/data`,
        name: `${dbKey}: ${row.schema}.${row.name}`,
        description: `First ${DEFAULT_LIMIT} rows of ${row.schema}.${row.name} in ${config.database}`,
        mimeType: "text/csv",
      });
    }
  }
  return { resources };
}

function registerAll(server) {
  server.registerResource(
    "tables",
    new ResourceTemplate("mssql://{dbKey}@{tablePart}/data", {
      list: listAllTables,
    }),
    {
      description:
        "Read the first N rows of any configured table as CSV. URI: mssql://[dbKey@]<schema>.<table>/data",
      mimeType: "text/csv",
    },
    async (uri) => {
      const { dbKey, tablePart } = parseUri(uri.href || uri.toString());
      const { dbKey: actualKey, config } = getConfig(dbKey);
      splitTableIdentifier(tablePart);
      const pool = await getPool(actualKey, config);
      const csv = await runRead(pool, async (request) => {
        const query = `SELECT TOP ${DEFAULT_LIMIT} * FROM ${quoteTable(tablePart)}`;
        const r = await request.query(query);
        return toCsv(config.database, r.recordset);
      });
      return {
        contents: [
          {
            uri: uri.href || uri.toString(),
            mimeType: "text/csv",
            text: csv,
          },
        ],
      };
    }
  );
}

module.exports = { registerAll, parseUri, toCsv };
