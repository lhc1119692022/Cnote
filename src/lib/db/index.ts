import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

let db: ReturnType<typeof drizzle>;

export function getDatabase() {
  if (!db) {
    // Use current directory for web version, will be overridden in Electron
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "cnote.db");
    const sqlite = new Database(dbPath);
    db = drizzle(sqlite, { schema });
  }
  return db;
}

export { schema };
