import { getDatabase } from "./index";
import { contentLibrary } from "./content-library-api";
import { templateLibrary } from "./template-library-api";

/**
 * 运行数据库迁移
 * 创建新增的表结构
 */
export async function runMigrations() {
  const db = getDatabase();

  try {
    // 创建内容库表
    db.run(`
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
    db.run(`
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

    console.log("✓ 数据库迁移完成");
  } catch (error) {
    console.error("数据库迁移失败:", error);
    throw error;
  }
}
