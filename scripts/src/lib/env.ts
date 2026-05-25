import dotenv from "dotenv";
dotenv.config();

export const env = {
  readwiseToken: process.env.READWISE_TOKEN || "",
  readwiseUseCli: (process.env.READWISE_USE_CLI || "true") !== "false",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, ""),
  timezone: process.env.REPORT_TIMEZONE || "Asia/Tokyo",
  lookbackHours: Number(process.env.REPORT_LOOKBACK_HOURS || "24"),
};
