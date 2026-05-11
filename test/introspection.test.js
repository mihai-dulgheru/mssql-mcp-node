const test = require("node:test");
const assert = require("node:assert/strict");
const queries = require("../src/db/introspection");

test("every exported SQL query uses parameterized placeholders, not concatenation", () => {
  for (const [name, sql] of Object.entries(queries)) {
    assert.equal(typeof sql, "string", `${name} should be a string`);
    // No string concatenation markers
    assert.equal(
      /\$\{/.test(sql),
      false,
      `${name} contains template literal placeholder`
    );
  }
});

test("LIST queries support OFFSET/FETCH pagination", () => {
  assert.match(queries.LIST_TABLES_SQL, /OFFSET\s+@offset/);
  assert.match(queries.LIST_TABLES_SQL, /FETCH\s+NEXT\s+@limit/);
  assert.match(queries.LIST_VIEWS_SQL, /OFFSET\s+@offset/);
  assert.match(queries.LIST_PROCEDURES_SQL, /OFFSET\s+@offset/);
});

test("DESCRIBE_TABLE_SQL filters by parameterized table name", () => {
  assert.match(queries.DESCRIBE_TABLE_SQL, /TABLE_NAME\s*=\s*@tname/);
  assert.equal(queries.DESCRIBE_TABLE_SQL.includes("TABLE_SCHEMA"), false);
});

test("DESCRIBE_TABLE_WITH_SCHEMA_SQL filters by both schema and table", () => {
  assert.match(
    queries.DESCRIBE_TABLE_WITH_SCHEMA_SQL,
    /TABLE_SCHEMA\s*=\s*@tschema/
  );
  assert.match(
    queries.DESCRIBE_TABLE_WITH_SCHEMA_SQL,
    /TABLE_NAME\s*=\s*@tname/
  );
});

test("LIST_INDEXES_SQL filters by parameterized table/schema", () => {
  assert.match(queries.LIST_INDEXES_SQL, /t\.name\s*=\s*@tname/);
  assert.match(queries.LIST_INDEXES_SQL, /@tschema/);
});

test("LIST_FOREIGN_KEYS_SQL handles optional table filter and pagination", () => {
  assert.match(queries.LIST_FOREIGN_KEYS_SQL, /@tname IS NULL/);
  assert.match(queries.LIST_FOREIGN_KEYS_SQL, /OFFSET\s+@offset/);
  assert.match(queries.LIST_FOREIGN_KEYS_SQL, /FETCH\s+NEXT\s+@limit/);
  assert.match(queries.COUNT_FOREIGN_KEYS_SQL, /COUNT\(\*\)\s+AS\s+total/i);
});

test("count queries return a total column", () => {
  for (const q of [
    queries.COUNT_TABLES_SQL,
    queries.COUNT_VIEWS_SQL,
    queries.COUNT_PROCEDURES_SQL,
  ]) {
    assert.match(q, /COUNT\(\*\)\s+AS\s+total/i);
  }
});
