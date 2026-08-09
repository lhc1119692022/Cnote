import { getDatabase } from "./db";
import { sources, flows, outputs, templates, apiKeys, styleProfiles, settings } from "./db/schema";
import { eq } from "drizzle-orm";

const db = getDatabase();

// Sources
export async function createSource(data: {
  id: string;
  title: string;
  type: string;
  content: string;
  metadata?: string;
}) {
  return db.insert(sources).values({
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getSources() {
  return db.select().from(sources).all();
}

export async function getSourceById(id: string) {
  return db.select().from(sources).where(eq(sources.id, id)).get();
}

export async function deleteSource(id: string) {
  return db.delete(sources).where(eq(sources.id, id));
}

// Flows
export async function createFlow(data: {
  id: string;
  name: string;
  description?: string;
  nodes: string;
  edges: string;
}) {
  return db.insert(flows).values({
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getFlows() {
  return db.select().from(flows).all();
}

export async function getFlowById(id: string) {
  return db.select().from(flows).where(eq(flows.id, id)).get();
}

export async function updateFlow(id: string, data: Partial<typeof flows.$inferInsert>) {
  return db.update(flows).set({ ...data, updatedAt: new Date() }).where(eq(flows.id, id));
}

export async function deleteFlow(id: string) {
  return db.delete(flows).where(eq(flows.id, id));
}

// Outputs
export async function createOutput(data: {
  id: string;
  flowId: string;
  title: string;
  content: string;
  metadata?: string;
}) {
  return db.insert(outputs).values({
    ...data,
    createdAt: new Date(),
  });
}

export async function getOutputs() {
  return db.select().from(outputs).all();
}

export async function getOutputById(id: string) {
  return db.select().from(outputs).where(eq(outputs.id, id)).get();
}

export async function deleteOutput(id: string) {
  return db.delete(outputs).where(eq(outputs.id, id));
}

// API Keys
export async function saveApiKey(data: { id: string; provider: string; key: string }) {
  return db.insert(apiKeys).values({
    ...data,
    createdAt: new Date(),
  });
}

export async function getApiKeys() {
  return db.select().from(apiKeys).all();
}

export async function getApiKeyByProvider(provider: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.provider, provider)).get();
}

export async function deleteApiKey(id: string) {
  return db.delete(apiKeys).where(eq(apiKeys.id, id));
}

// Style Profiles
export async function createStyleProfile(data: {
  id: string;
  name: string;
  tone: string;
  length: string;
  format: string;
  isDefault?: boolean;
}) {
  return db.insert(styleProfiles).values({
    ...data,
    createdAt: new Date(),
  });
}

export async function getStyleProfiles() {
  return db.select().from(styleProfiles).all();
}

export async function deleteStyleProfile(id: string) {
  return db.delete(styleProfiles).where(eq(styleProfiles.id, id));
}

// Settings
export async function saveSetting(key: string, value: string) {
  return db.insert(settings).values({
    key,
    value,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value, updatedAt: new Date() },
  });
}

export async function getSetting(key: string) {
  return db.select().from(settings).where(eq(settings.key, key)).get();
}
