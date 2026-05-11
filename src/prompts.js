const { z } = require("zod");

function explorePrompt({ dbKey }) {
  const dbPhrase = dbKey ? ` the ${dbKey} database` : " a configured database";
  const dbArg = dbKey ? `, dbKey="${dbKey}"` : "";
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Please explore${dbPhrase} and produce a structured summary.`,
            "",
            "Suggested steps:",
            `1. Call \`list_databases\`${dbKey ? "" : " and pick a database"}.`,
            `2. Call \`describe_database\`${dbArg} to see table/view/procedure counts.`,
            `3. Call \`list_tables\` (paginate with offset/limit if total > 100).`,
            `4. For 3-5 representative tables, call \`describe_table\` and \`list_indexes\`.`,
            `5. Call \`list_foreign_keys\` (no \`table\` arg) to map relationships.`,
            `6. Summarize: domain, key entities, join paths, anomalies.`,
            "",
            "Do NOT call `execute_read_query` until you need actual row data to answer a follow-up.",
          ].join("\n"),
        },
      },
    ],
  };
}

function summarizeTablePrompt({ table, dbKey }) {
  const dbPhrase = dbKey ? ` in database ${dbKey}` : "";
  const dbArg = dbKey ? `, dbKey="${dbKey}"` : "";
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Summarize the table \`${table}\`${dbPhrase}:`,
            `1. Call \`describe_table\` with table="${table}"${dbArg}.`,
            `2. Call \`list_indexes\` with the same arguments.`,
            `3. Call \`list_foreign_keys\` with the same arguments.`,
            `4. Call \`execute_read_query\` with \`SELECT TOP 5 * FROM ${table}\` for sample rows.`,
            `5. Produce: purpose, key columns, join points, columns that look suspicious or denormalized.`,
          ].join("\n"),
        },
      },
    ],
  };
}

function registerAll(server) {
  server.registerPrompt(
    "explore_database",
    {
      title: "Explore a database",
      description:
        "Guided walkthrough: pick a database, see what's in it, decide where to dig.",
      argsSchema: { dbKey: z.string().optional() },
    },
    explorePrompt
  );

  server.registerPrompt(
    "summarize_table",
    {
      title: "Summarize a table",
      description:
        "Column-by-column summary plus sample rows for a single table.",
      argsSchema: { table: z.string(), dbKey: z.string().optional() },
    },
    summarizeTablePrompt
  );
}

module.exports = { registerAll, explorePrompt, summarizeTablePrompt };
