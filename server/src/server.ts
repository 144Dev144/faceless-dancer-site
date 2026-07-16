import http from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { runMigrations } from "./db/postgresMigrateUtil.js";
import { closePool } from "./db/postgres.js";
import { closeDanceOffSocketServer, createDanceOffSocketServer } from "./modules/danceOff/socket.js";

if (env.runMigrationsOnStart) {
  await runMigrations();
} else {
  console.log("Startup migrations disabled (RUN_MIGRATIONS_ON_START=false).");
}

const httpServer = http.createServer(app);
const io = await createDanceOffSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
  console.log(`PostgreSQL pool budget: max=${env.databasePoolMax}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  await closeDanceOffSocketServer(io);
  if (httpServer.listening) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
  await closePool();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
