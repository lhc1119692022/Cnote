import { getDatabase } from "@/lib/db";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";

// 定义内容库表
export const contentLibrary = sqliteTable("content_library", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(), // text, youtube, pdf, image, video, table, web, url
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string
  tags: text("tags"), // comma-separated tags
  category: text("category"), // 分类
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

const db = getDatabase();

// 内容库 API
export const contentLibraryApi = {
  // 获取所有内容
  getAll: () => db.select().from(contentLibrary).all(),

  // 根据分类获取
  getByCategory: (category: string) =>
    db.select().from(contentLibrary).where(eq(contentLibrary.category, category)).all(),

  // 根据ID获取
  getById: (id: string) =>
    db.select().from(contentLibrary).where(eq(contentLibrary.id, id)).get(),

  // 创建内容
  create: (data: {
    title: string;
    type: string;
    content: string;
    metadata?: string;
    tags?: string;
    category?: string;
  }) => {
    const now = new Date();
    const item = {
      id: Date.now().toString(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(contentLibrary).values(item).run();
    return item;
  },

  // 更新内容
  update: (
    id: string,
    data: {
      title?: string;
      content?: string;
      metadata?: string;
      tags?: string;
      category?: string;
    }
  ) => {
    const updates = {
      ...data,
      updatedAt: new Date(),
    };
    db.update(contentLibrary).set(updates).where(eq(contentLibrary.id, id)).run();
    return db.select().from(contentLibrary).where(eq(contentLibrary.id, id)).get();
  },

  // 删除内容
  delete: (id: string) => db.delete(contentLibrary).where(eq(contentLibrary.id, id)).run(),

  // 搜索内容
  search: (query: string) => {
    const allItems = db.select().from(contentLibrary).all();
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.content.toLowerCase().includes(query.toLowerCase()) ||
        (item.tags && item.tags.toLowerCase().includes(query.toLowerCase()))
    );
  },
};

// 导出单独的函数
export const getAllContentLibrary = contentLibraryApi.getAll;
export const getContentLibraryByCategory = contentLibraryApi.getByCategory;
export const getContentLibraryById = contentLibraryApi.getById;
export const createContentLibrary = contentLibraryApi.create;
export const updateContentLibrary = contentLibraryApi.update;
export const deleteContentLibrary = contentLibraryApi.delete;
export const searchContentLibrary = contentLibraryApi.search;
