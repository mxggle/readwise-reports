import dotenv from "dotenv";
dotenv.config();

export const env = {
  readwiseToken: process.env.READWISE_TOKEN || "",
  readwiseUseCli: (process.env.READWISE_USE_CLI || "true") !== "false",
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, ""),
  timezone: process.env.REPORT_TIMEZONE || "Asia/Tokyo",
  processedDbPath: process.env.READWISE_PROCESSED_DB || "generated/readwise-processed.sqlite",
};
