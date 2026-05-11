const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUri, toCsv } = require("../src/resources");

test("parseUri requires <dbKey>@<table>/data form", () => {
  assert.deepEqual(parseUri("mssql://main@dbo.Users/data"), {
    dbKey: "main",
    tablePart: "dbo.Users",
  });
  assert.deepEqual(parseUri("mssql://reporting@Users/data"), {
    dbKey: "reporting",
    tablePart: "Users",
  });
});

test("parseUri rejects dbKey-less URIs", () => {
  assert.throws(() => parseUri("mssql://dbo.Users/data"));
  assert.throws(() => parseUri("mssql://Users/data"));
  assert.throws(() => parseUri("mssql://main@/data"));
  assert.throws(() => parseUri("http://main@Users/data"));
});

test("toCsv emits leading database comment", () => {
  const csv = toCsv("my_db", [{ id: 1, name: "x" }]);
  assert.ok(csv.startsWith("# Database: my_db"));
  assert.ok(csv.includes("id,name"));
  assert.ok(csv.includes("1,x"));
});

test("toCsv quotes values with commas, quotes, newlines", () => {
  const csv = toCsv("d", [{ s: "a,b" }]);
  assert.match(csv, /"a,b"/);
  const csvQ = toCsv("d", [{ s: 'a"b' }]);
  assert.match(csvQ, /"a""b"/);
  const csvN = toCsv("d", [{ s: "a\nb" }]);
  assert.match(csvN, /"a\nb"/);
});

test("toCsv emits empty string for null/undefined", () => {
  const csv = toCsv("d", [{ a: null, b: undefined, c: 0, d: "" }]);
  const dataLine = csv.split("\n")[2];
  // a is empty, b is empty, c is "0", d is empty -> ",,0,"
  assert.equal(dataLine, ",,0,");
});

test("toCsv returns just the header comment when recordset is empty", () => {
  assert.equal(toCsv("d", []), "# Database: d\n");
});
