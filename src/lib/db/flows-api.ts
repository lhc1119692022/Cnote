import { getDatabase } from "@/lib/db";
import { sources, flows } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const db = getDatabase();

// Flow API
export const flowsApi = {
  getAll: () => db.select().from(flows).all(),

  getById: (id: string) => db.select().from(flows).where(eq(flows.id, id)).get(),

  create: (data: {
    name: string;
    nodes: string;
    edges: string;
    description?: string;
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

  update: (id: string, data: { name?: string; nodes?: string; edges?: string; description?: string }) => {
    const updates = {
      ...data,
      updatedAt: new Date(),
    };
    db.update(flows).set(updates).where(eq(flows.id, id)).run();
    return db.select().from(flows).where(eq(flows.id, id)).get();
  },

  delete: (id: string) => db.delete(flows).where(eq(flows.id, id)).run(),
};

// 导出单独的函数
export const getAllFlows = flowsApi.getAll;
export const getFlowById = flowsApi.getById;
export const createFlow = flowsApi.create;
export const updateFlow = flowsApi.update;
export const deleteFlow = flowsApi.delete;
