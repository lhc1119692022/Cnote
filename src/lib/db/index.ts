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

    // 运行数据库迁移
    initDatabase(sqlite);
  }
  return db;
}

function initDatabase(sqlite: Database.Database) {
  // 创建内容库表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS content_library (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      tags TEXT,
      category TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 创建模板库表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS template_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      nodes TEXT NOT NULL,
      edges TEXT NOT NULL,
      thumbnail TEXT,
      tags TEXT,
      is_built_in INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

export { schema };
