const { startServer } = require("./server");
const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

startServer();

// Handle SIGINT (Ctrl+C) to gracefully shut down the server
process.on("SIGINT", function () {
  console.log("Received SIGINT. Exiting...");
  process.exit();
});
