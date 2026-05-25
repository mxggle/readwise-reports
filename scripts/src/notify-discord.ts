import dotenv from "dotenv";
dotenv.config();

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook) {
  console.log("DISCORD_WEBHOOK_URL missing, skip notification");
  process.exit(0);
}

const title = process.argv[2] || "Readwise Daily Report";
const summary = process.argv[3] || "日报已生成。";
const url = process.argv[4] || process.env.PUBLIC_SITE_URL || "";

const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    embeds: [{
      title,
      description: summary.split("\n").slice(0, 3).join("\n"),
      url: url || undefined,
      color: 0x5865F2,
      footer: { text: "Readwise Reports" },
      timestamp: new Date().toISOString(),
    }],
  }),
});
if (!res.ok) throw new Error(`Discord webhook failed ${res.status}: ${await res.text()}`);
console.log("Discord notified");
