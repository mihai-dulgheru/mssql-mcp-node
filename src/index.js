const { startServer } = require("./server");
const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

startServer();
