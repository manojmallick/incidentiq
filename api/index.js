// Vercel serverless entry point — re-exports the Express app as the function handler.
// All routes (/, /health, /api/*) are routed here via vercel.json.
import app from "../src/server.js";
export default app;
