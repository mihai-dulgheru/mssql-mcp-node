const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  tableIdentifier,
  paginationShape,
  dbKeyShape,
  resourceUri,
  MAX_LIMIT,
} = require("../src/validation");

test("tableIdentifier accepts bare and schema.table", () => {
  assert.equal(tableIdentifier.parse("Users"), "Users");
  assert.equal(tableIdentifier.parse("dbo.Users"), "dbo.Users");
  assert.equal(tableIdentifier.parse("dbo.Users_2024"), "dbo.Users_2024");
});

test("tableIdentifier rejects injection-y characters", () => {
  assert.throws(() => tableIdentifier.parse("Users;DROP"));
  assert.throws(() => tableIdentifier.parse("a b"));
  assert.throws(() => tableIdentifier.parse("a.b.c"));
  assert.throws(() => tableIdentifier.parse("[Users]"));
});

test("paginationShape defaults to limit=100, offset=0", () => {
  const schema = z.object(paginationShape);
  const out = schema.parse({});
  assert.equal(out.limit, 100);
  assert.equal(out.offset, 0);
});

test("paginationShape caps limit at MAX_LIMIT", () => {
  const schema = z.object(paginationShape);
  assert.throws(() => schema.parse({ limit: MAX_LIMIT + 1 }));
  schema.parse({ limit: MAX_LIMIT });
});

test("paginationShape rejects negative offset", () => {
  const schema = z.object(paginationShape);
  assert.throws(() => schema.parse({ offset: -1 }));
});

test("dbKeyShape is optional and validates format", () => {
  const schema = z.object(dbKeyShape);
  schema.parse({});
  schema.parse({ dbKey: "main_db" });
  assert.throws(() => schema.parse({ dbKey: "bad-key!" }));
  assert.throws(() => schema.parse({ dbKey: "" }));
});

test("resourceUri requires <dbKey>@<table>/data form", () => {
  resourceUri.parse("mssql://main@dbo.Users/data");
  resourceUri.parse("mssql://main@Users/data");
  assert.throws(() => resourceUri.parse("mssql://Users/data"));
  assert.throws(() => resourceUri.parse("mssql://dbo.Users/data"));
  assert.throws(() => resourceUri.parse("http://main@Users/data"));
  assert.throws(() => resourceUri.parse("mssql:///data"));
});
