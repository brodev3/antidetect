import Database from "better-sqlite3";

export const APP_ROOT_IN_USE = "APP_ROOT_IN_USE" as const;

type SqliteDatabase = ReturnType<typeof Database>;

export interface RootOwnership {
  readonly sqlite: SqliteDatabase;
  close(): void;
}

export class AppRootInUseError extends Error {
  readonly code = APP_ROOT_IN_USE;

  constructor(
    readonly databasePath: string,
    cause: unknown,
  ) {
    super(`Application root is already in use: ${databasePath}`, { cause });
    this.name = "AppRootInUseError";
  }
}

function isBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return true;
  }

  const message = "message" in error ? error.message : undefined;
  return (
    typeof message === "string" &&
    /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)
  );
}

function unicodeLower(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

export function acquireRootOwnership(databasePath: string): RootOwnership {
  let database: ReturnType<typeof Database> | undefined;

  try {
    database = new Database(databasePath, { timeout: 250 });
    database.pragma("foreign_keys = ON");
    database.function("unicode_lower", { deterministic: true }, unicodeLower);
    database.pragma("locking_mode = EXCLUSIVE");
    database.exec("BEGIN EXCLUSIVE; COMMIT;");
  } catch (error) {
    if (database?.open) {
      database.close();
    }

    if (isBusyError(error)) {
      throw new AppRootInUseError(databasePath, error);
    }

    throw error;
  }

  return {
    sqlite: database,
    close(): void {
      if (database?.open) {
        database.close();
      }
    },
  };
}
