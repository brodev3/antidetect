import Database from "better-sqlite3";

const databasePath = process.argv[2];

try {
  const database = new Database(databasePath, { timeout: 250 });
  database.pragma("locking_mode = EXCLUSIVE");
  database.exec("BEGIN EXCLUSIVE; COMMIT;");
  process.stdout.write("ACQUIRED\n");

  const close = () => {
    if (database.open) {
      database.close();
    }
    process.exit(0);
  };

  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  setInterval(() => undefined, 1_000);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exit(2);
}
