import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./env.js";
import type { ClassifiedItem } from "./types.js";

export async function summarizeWithAi(items: ClassifiedItem[]): Promise<string> {
  const top = items.filter((i) => i.action !== "IGNORE").slice(0, 8);
  const prompt = `请用中文总结今天的阅读内容。要求：直接、短、适合长期知识库。输出 4-6 句话，重点说趋势、对 Harry 的职业/学习意义、今天最该做的一件事。\n\n${top.map((i, idx) => `${idx + 1}. [${i.topic}][${i.action}] ${i.title}\n${i.summary || i.text.slice(0, 500)}`).join("\n\n")}`;

  if (env.openaiApiKey) {
    const openai = new OpenAI({ apiKey: env.openaiApiKey });
    const res = await openai.chat.completions.create({
      model: env.openaiModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });
    return res.choices[0]?.message?.content?.trim() || fallback(top);
  }

  if (env.geminiApiKey) {
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: env.geminiModel });
    const res = await model.generateContent(prompt);
    return res.response.text().trim() || fallback(top);
  }

  return fallback(top);
}

function fallback(items: ClassifiedItem[]) {
  const topics = [...new Set(items.map((i) => i.topic))].join("、") || "阅读";
  const first = items[0]?.title || "暂无高质量内容";
  return `今天的高价值内容集中在 ${topics}。最值得优先处理的是《${first}》。整体建议是少追新闻，多沉淀能服务求职、英语/日语学习和 AI 工程实践的材料。今天只做一件事：读完 Top 1，并写下一个可执行行动。`;
}
