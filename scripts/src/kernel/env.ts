import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const rawPublicSiteUrl = (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
const publicSiteUrlSchema = z.union([z.literal(""), z.string().url()]);
const publicSiteUrlParsed = publicSiteUrlSchema.safeParse(rawPublicSiteUrl);
if (!publicSiteUrlParsed.success) {
  console.warn(`[env] PUBLIC_SITE_URL is not a valid URL: "${rawPublicSiteUrl}". Ignoring.`);
}

export const env = {
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  publicSiteUrl: publicSiteUrlParsed.success ? publicSiteUrlParsed.data : "",
  timezone: process.env.REPORT_TIMEZONE || "Asia/Tokyo",
  processedDbPath: process.env.READWISE_PROCESSED_DB || "generated/readwise-processed.sqlite",
};
