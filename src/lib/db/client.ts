import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(
  process.env.DATABASE_PATH || "cnote.db"
);

export const db = drizzle(sqlite, { schema });

// 初始化数据库表
export function initDatabase() {
  // Sources 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      raw_text TEXT,
      url TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Flows 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nodes TEXT NOT NULL,
      edges TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Outputs 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS outputs (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      flow_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // API Keys 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Style Profiles 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS style_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      tone TEXT NOT NULL,
      style TEXT NOT NULL,
      audience TEXT NOT NULL,
      is_built_in INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // Templates 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      nodes TEXT NOT NULL,
      edges TEXT NOT NULL,
      is_built_in INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
}
