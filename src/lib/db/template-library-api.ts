import { getDatabase } from "@/lib/db";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";

// 定义模板库表
export const templateLibrary = sqliteTable("template_library", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // 内容处理、视频处理、翻译、营销等
  nodes: text("nodes").notNull(), // JSON string
  edges: text("edges").notNull(), // JSON string
  thumbnail: text("thumbnail"), // 缩略图URL
  tags: text("tags"), // comma-separated tags
  isBuiltIn: integer("is_built_in", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

const db = getDatabase();

// 模板库 API
export const templateLibraryApi = {
  // 获取所有模板
  getAll: () => db.select().from(templateLibrary).all(),

  // 根据分类获取
  getByCategory: (category: string) =>
    db.select().from(templateLibrary).where(eq(templateLibrary.category, category)).all(),

  // 根据ID获取
  getById: (id: string) =>
    db.select().from(templateLibrary).where(eq(templateLibrary.id, id)).get(),

  // 创建模板
  create: (data: {
    name: string;
    description?: string;
    category: string;
    nodes: string;
    edges: string;
    thumbnail?: string;
    tags?: string;
    isBuiltIn?: boolean;
  }) => {
    const now = new Date();
    const template = {
      id: Date.now().toString(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(templateLibrary).values(template).run();
    return template;
  },

  // 更新模板
  update: (
    id: string,
    data: {
      name?: string;
      description?: string;
      category?: string;
      nodes?: string;
      edges?: string;
      thumbnail?: string;
      tags?: string;
    }
  ) => {
    const updates = {
      ...data,
      updatedAt: new Date(),
    };
    db.update(templateLibrary).set(updates).where(eq(templateLibrary.id, id)).run();
    return db.select().from(templateLibrary).where(eq(templateLibrary.id, id)).get();
  },

  // 删除模板
  delete: (id: string) => db.delete(templateLibrary).where(eq(templateLibrary.id, id)).run(),

  // 搜索模板
  search: (query: string) => {
    const allTemplates = db.select().from(templateLibrary).all();
    return allTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(query.toLowerCase()) ||
        (template.description && template.description.toLowerCase().includes(query.toLowerCase())) ||
        (template.tags && template.tags.toLowerCase().includes(query.toLowerCase()))
    );
  },
};

// 导出单独的函数
export const getAllTemplates = templateLibraryApi.getAll;
export const getTemplatesByCategory = templateLibraryApi.getByCategory;
export const getTemplateById = templateLibraryApi.getById;
export const createTemplate = templateLibraryApi.create;
export const updateTemplate = templateLibraryApi.update;
export const deleteTemplate = templateLibraryApi.delete;
export const searchTemplates = templateLibraryApi.search;
