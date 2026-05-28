export type AIMode = "api" | "agent" | "auto";
export type AIProvider = "openai" | "gemini" | "anthropic";

export interface SkillManifest {
  id: string;
  title: string;
  description?: string;
  enabled?: boolean;
  ai?: {
    mode?: AIMode;
    provider?: AIProvider;
    model?: string;
    inputLanguage?: string;
    outputLanguage?: string;
  };
  schedule?: {
    cron?: string;
    timezone?: string;
    lookbackHours?: number;
  };
  output?: {
    dir?: string;
    navSection?: string;
    icon?: string;
  };
  env?: {
    required?: string[];
  };
  dedup?: {
    enabled?: boolean;
    keyField?: string;
  };
  filters?: {
    excludeTags?: string[];
    blockDomains?: string[];
  };
  digest?: {
    maxItems?: number;
    tone?: string;
  };
  notification?: {
    channels?: string[];
  };
}

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

export interface SkillContext {
  config: SkillManifest;
  ai: AIClient;
  log: Logger;
  dryRun: boolean;
  date: string;
}

export interface SkillResult {
  itemsProcessed: number;
  itemsSkipped: number;
  outputPath?: string;
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
