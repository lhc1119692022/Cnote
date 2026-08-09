import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(), // text, url, youtube, file
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const flows = sqliteTable("flows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  nodes: text("nodes").notNull(), // JSON string
  edges: text("edges").notNull(), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const outputs = sqliteTable("outputs", {
  id: text("id").primaryKey(),
  flowId: text("flow_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  content: text("content").notNull(), // Flow configuration JSON
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(), // anthropic, openai, google, etc.
  key: text("key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const styleProfiles = sqliteTable("style_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tone: text("tone").notNull(),
  length: text("length").notNull(),
  format: text("format").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
