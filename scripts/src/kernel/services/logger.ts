import type { Logger } from "../types.js";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw as Level] ?? LEVELS.info;
}

function enabled(level: Level): boolean {
  return LEVELS[level] >= currentLevel();
}

export function consoleLogger(prefix: string): Logger {
  const tag = `[${prefix}]`;
  return {
    debug: (msg, ...args) => {
      if (enabled("debug")) console.debug(`${tag} ${msg}`, ...args);
    },
    info: (msg, ...args) => {
      if (enabled("info")) console.log(`${tag} ${msg}`, ...args);
    },
    warn: (msg, ...args) => {
      if (enabled("warn")) console.warn(`${tag} ${msg}`, ...args);
    },
    error: (msg, ...args) => {
      if (enabled("error")) console.error(`${tag} ${msg}`, ...args);
    },
  };
}
