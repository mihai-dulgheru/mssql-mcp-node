const { z } = require("zod");
const sql = require("mssql");
const { getConfig } = require("../config");
const { getPool } = require("../db/pools");
const { runRead, splitTableIdentifier } = require("../db/safety");
const { dbKeyShape, tableIdentifier } = require("../validation");
const { DESCRIBE_PROCEDURE_SQL } = require("../db/introspection");

const outputShape = {
  db: z.string(),
  dbKey: z.string(),
  procedure: z.string(),
  parameters: z.array(
    z.object({
      name: z.string().nullable(),
      type: z.string().nullable(),
      mode: z.string().nullable(),
      position: z.number().int(),
    })
  ),
};

async function handler({ dbKey, procedure }, extra) {
  const { dbKey: actualKey, config } = getConfig(dbKey);
  const { schema, table: name } = splitTableIdentifier(procedure);
  const pool = await getPool(actualKey, config);
  const parameters = await runRead(
    pool,
    async (request) => {
      request.input("pname", sql.NVarChar, name);
      request.input("pschema", sql.NVarChar, schema);
      const r = await request.query(DESCRIBE_PROCEDURE_SQL);
      return r.recordset;
    },
    { signal: extra?.signal }
  );
  const structured = {
    db: config.database,
    dbKey: actualKey,
    procedure,
    parameters: parameters.map((p) => ({
      name: p.name ?? null,
      type: p.type ?? null,
      mode: p.mode ?? null,
      position: p.position,
    })),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

module.exports = {
  name: "describe_procedure",
  config: {
    title: "Describe Procedure",
    description:
      "Parameters of a stored procedure. Accepts bare or `schema.procedure` identifiers (e.g. `dbo.usp_UpdateUser`).",
    inputSchema: { procedure: tableIdentifier, ...dbKeyShape },
    outputSchema: outputShape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  handler,
};
