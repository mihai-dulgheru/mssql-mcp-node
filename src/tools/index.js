const modules = [
  require("./execute-read-query"),
  require("./execute-write-query"),
  require("./list-databases"),
  require("./describe-database"),
  require("./list-tables"),
  require("./list-views"),
  require("./list-indexes"),
  require("./list-foreign-keys"),
  require("./list-stored-procedures"),
  require("./describe-table"),
  require("./describe-procedure"),
];

function registerAll(server) {
  for (const { name, config, handler } of modules) {
    server.registerTool(name, config, handler);
  }
}

module.exports = { registerAll, modules };
