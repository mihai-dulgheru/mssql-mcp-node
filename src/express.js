require("dotenv").config();
const { startServer } = require("./server");

// Start the server
startServer();

// Handle SIGINT (Ctrl+C) to gracefully shut down the server
process.on("SIGINT", function () {
  console.log("Received SIGINT. Exiting...");
  process.exit();
});
