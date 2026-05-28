import type { Logger } from "../types.js";

export function consoleLogger(prefix: string): Logger {
  const tag = `[${prefix}]`;
  return {
    info: (msg, ...args) => console.log(`${tag} ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`${tag} ${msg}`, ...args),
    error: (msg, ...args) => console.error(`${tag} ${msg}`, ...args),
    debug: (msg, ...args) => {
      if (process.env.DEBUG) console.debug(`${tag} ${msg}`, ...args);
    },
  };
}
