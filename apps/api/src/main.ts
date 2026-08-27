import { buildApp } from "./app.js";
import { resolveAppPaths } from "./config/app.paths.js";
import { ensureAppDirectories } from "./infrastructure/filesystem/app.directories.js";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.API_PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("API_PORT must be an integer between 1 and 65535");
}

const appPaths = resolveAppPaths();
await ensureAppDirectories(appPaths);

const app = await buildApp();

try {
  await app.listen({ host, port });
  console.log(`Antidetect API listening on http://${host}:${port}`);
} catch (error) {
  await app.close();
  throw error;
}
