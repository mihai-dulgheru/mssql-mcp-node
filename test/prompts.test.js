const test = require("node:test");
const assert = require("node:assert/strict");
const { explorePrompt, summarizeTablePrompt } = require("../src/prompts");

test("explorePrompt renders dbKey-specific guidance when provided", () => {
  const result = explorePrompt({ dbKey: "reporting" });
  const text = result.messages[0].content.text;
  assert.match(text, /the reporting database/);
  assert.match(text, /dbKey="reporting"/);
  assert.match(text, /list_tables/);
  assert.match(text, /describe_database/);
});

test("explorePrompt is generic when no dbKey is given", () => {
  const result = explorePrompt({});
  const text = result.messages[0].content.text;
  assert.match(text, /a configured database/);
  assert.match(text, /and pick a database/);
});

test("summarizeTablePrompt mentions the table and the right tools", () => {
  const result = summarizeTablePrompt({ table: "dbo.Orders", dbKey: "main" });
  const text = result.messages[0].content.text;
  assert.match(text, /dbo\.Orders/);
  assert.match(text, /describe_table/);
  assert.match(text, /list_indexes/);
  assert.match(text, /list_foreign_keys/);
  assert.match(text, /execute_read_query/);
  assert.match(text, /dbKey="main"/);
});

test("summarizeTablePrompt omits dbKey when not provided", () => {
  const result = summarizeTablePrompt({ table: "Orders" });
  const text = result.messages[0].content.text;
  assert.match(text, /Orders/);
  assert.equal(/dbKey=/.test(text), false);
});
