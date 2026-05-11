const { z } = require("zod");

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;
const MAX_QUERY_LEN = 10000;

const tableIdentifier = z
  .string()
  .min(1)
  .max(260)
  .regex(/^[a-zA-Z0-9_#$@]+(?:\.[a-zA-Z0-9_#$@]+)?$/, {
    message:
      "Use bare or `schema.table` identifiers - only alphanumerics, underscore, #, $, @",
  });

const dbKeyShape = {
  dbKey: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: "dbKey must be alphanumeric/underscore",
    })
    .optional()
    .describe(
      "Database key (lowercased). Optional in single-database mode. Call `list_databases` to discover valid keys."
    ),
};

const paginationShape = {
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Max rows to return (1..${MAX_LIMIT}).`),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Row offset for pagination."),
};

const queryString = z.string().min(1).max(MAX_QUERY_LEN);

const resourceUri = z
  .string()
  .regex(
    /^mssql:\/\/[a-zA-Z0-9_]+@[a-zA-Z0-9_#$@]+(?:\.[a-zA-Z0-9_#$@]+)?\/data$/,
    {
      message:
        "URI must match mssql://<dbKey>@<table>/data or mssql://<dbKey>@<schema>.<table>/data",
    }
  );

module.exports = {
  tableIdentifier,
  dbKeyShape,
  paginationShape,
  queryString,
  resourceUri,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  MAX_QUERY_LEN,
};
