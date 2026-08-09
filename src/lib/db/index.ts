import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import { app } from "electron";

let db: ReturnType<typeof drizzle>;

export function getDatabase() {
  if (!db) {
    const dbPath = path.join(app.getPath("userData"), "cnote.db");
    const sqlite = new Database(dbPath);
    db = drizzle(sqlite, { schema });
  }
  return db;
}

export { schema };
