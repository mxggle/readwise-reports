import { z } from "zod";

export const AIModeSchema = z.enum(["api", "agent", "auto"]);
export const AIProviderSchema = z.enum(["openai", "gemini", "anthropic"]);
export type AIMode = z.infer<typeof AIModeSchema>;
export type AIProvider = z.infer<typeof AIProviderSchema>;

export const SkillManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be kebab-case starting with a letter"),
  title: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().default(true),

  ai: z
    .object({
      mode: AIModeSchema.default("auto"),
      provider: AIProviderSchema.default("openai"),
      model: z.string().optional(),
      inputLanguage: z.string().default("auto"),
      outputLanguage: z.string().default("en-US"),
    })
    .strict()
    .default({}),

  schedule: z
    .object({
      cron: z.string().optional(),
      timezone: z.string().default("UTC"),
      lookbackHours: z.number().positive().default(24),
    })
    .strict()
    .default({}),

  output: z
    .object({
      navSection: z.string().optional(),
      icon: z.string().optional(),
    })
    .strict()
    .default({}),

  env: z
    .object({
      required: z.array(z.string()).default([]),
    })
    .strict()
    .default({}),

  dedup: z
    .object({
      enabled: z.boolean().default(false),
      keyField: z.string().default("id"),
    })
    .strict()
    .default({}),

  filters: z
    .object({
      excludeTags: z.array(z.string()).default([]),
      blockDomains: z.array(z.string()).default([]),
    })
    .strict()
    .default({}),

  digest: z
    .object({
      maxItems: z.number().positive().default(50),
      tone: z.string().default("concise"),
    })
    .strict()
    .default({}),

  notification: z
    .object({
      channels: z.array(z.string()).default([]),
    })
    .strict()
    .default({}),
}).strict();

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export interface AICompleteOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIClient {
  complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface SkillPaths {
  outputDir: string;
  rawDir: string;
  generatedDir: string;
}

export interface SkillWriter {
  writeReport(body: string): Promise<string>;
  writeRaw(data: unknown): Promise<string>;
}

export interface SkillStore {
  filterUnprocessed<T extends DedupItem>(items: T[]): Promise<{ fresh: T[]; skipped: T[] }>;
  markProcessed<T extends DedupItem>(items: T[]): Promise<void>;
}

export interface SkillContext {
  config: SkillManifest;
  ai: AIClient;
  log: Logger;
  dryRun: boolean;
  date: string;
  timezone: string;
  paths: SkillPaths;
  writer: SkillWriter;
  store: SkillStore;
  publicSiteUrl?: string;
}

export interface NotificationPayload {
  channel: string;
  title: string;
  body: string;
  url?: string;
}

export interface SkillResult {
  itemsProcessed: number;
  itemsSkipped: number;
  outputPath?: string;
  notifications?: NotificationPayload[];
}

export interface DedupItem {
  id: string;
  url?: string;
  sourceUrl?: string;
  title: string;
  author?: string;
  source: string;
  text: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}
