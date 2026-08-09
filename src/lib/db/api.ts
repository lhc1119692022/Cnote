import { getDatabase } from "@/lib/db";
import { sources, flows, outputs, apiKeys, styleProfiles, templates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const db = getDatabase();

// Sources API
export const sourcesApi = {
  getAll: () => db.select().from(sources).all(),

  create: (data: {
    type: string;
    title: string;
    content: string;
    metadata?: string;
  }) => {
    const now = new Date();
    const source = {
      id: Date.now().toString(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(sources).values(source).run();
    return source;
  },

  delete: (id: string) => db.delete(sources).where(eq(sources.id, id)).run(),
};

// Flows API
export const flowsApi = {
  getAll: () => db.select().from(flows).all(),

  getById: (id: string) => db.select().from(flows).where(eq(flows.id, id)).get(),

  create: (data: {
    name: string;
    description?: string;
    nodes: string;
    edges: string;
  }) => {
    const now = new Date();
    const flow = {
      id: Date.now().toString(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(flows).values(flow).run();
    return flow;
  },

  update: (id: string, data: {
    name?: string;
    nodes?: string;
    edges?: string;
  }) => {
    const now = new Date();
    db.update(flows)
      .set({ ...data, updatedAt: now })
      .where(eq(flows.id, id))
      .run();
  },

  delete: (id: string) => db.delete(flows).where(eq(flows.id, id)).run(),
};

// Outputs API
export const outputsApi = {
  getAll: () => db.select().from(outputs).all(),

  create: (data: {
    flowId: string;
    title: string;
    content: string;
    metadata?: string;
  }) => {
    const output = {
      id: Date.now().toString(),
      ...data,
      createdAt: new Date(),
    };
    db.insert(outputs).values(output).run();
    return output;
  },

  delete: (id: string) => db.delete(outputs).where(eq(outputs.id, id)).run(),
};

// API Keys API
export const apiKeysApi = {
  getAll: () => db.select().from(apiKeys).all(),

  create: (data: { provider: string; key: string }) => {
    const apiKey = {
      id: Date.now().toString(),
      ...data,
      createdAt: new Date(),
    };
    db.insert(apiKeys).values(apiKey).run();
    return apiKey;
  },

  delete: (id: string) => db.delete(apiKeys).where(eq(apiKeys.id, id)).run(),
};

// Style Profiles API
export const styleProfilesApi = {
  getAll: () => db.select().from(styleProfiles).all(),

  create: (data: {
    name: string;
    tone: string;
    length: string;
    format: string;
    isDefault?: boolean;
  }) => {
    const profile = {
      id: Date.now().toString(),
      ...data,
      isDefault: data.isDefault || false,
      createdAt: new Date(),
    };
    db.insert(styleProfiles).values(profile).run();
    return profile;
  },

  update: (id: string, data: {
    name?: string;
    tone?: string;
    length?: string;
    format?: string;
  }) => {
    db.update(styleProfiles)
      .set(data)
      .where(eq(styleProfiles.id, id))
      .run();
  },

  delete: (id: string) => db.delete(styleProfiles).where(eq(styleProfiles.id, id)).run(),
};

// Templates API
export const templatesApi = {
  getAll: () => db.select().from(templates).all(),

  getById: (id: string) => db.select().from(templates).where(eq(templates.id, id)).get(),

  create: (data: {
    name: string;
    description?: string;
    category: string;
    content: string;
  }) => {
    const template = {
      id: Date.now().toString(),
      ...data,
      createdAt: new Date(),
    };
    db.insert(templates).values(template).run();
    return template;
  },

  delete: (id: string) => db.delete(templates).where(eq(templates.id, id)).run(),
};
