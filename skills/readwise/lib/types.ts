export type Topic = "AI" | "Programming" | "Japanese" | "English" | "Career" | "Business" | "Other";

export type SourceItem = {
  id: string;
  title: string;
  author?: string;
  url?: string;
  sourceUrl?: string;
  source: "readwise-highlight" | "reader-document";
  category?: string;
  location?: string;
  text: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedDate?: string;
  tags: string[];
  wordCount?: number;
};

export type ArticleAnalysis = {
  synopsis: string;
  keyPoints: string[];
  novelAngles: string[];
  verdict: string;
};

export type ClassifiedItem = SourceItem & {
  topic: Topic;
  score: number;
  action: "READ" | "SKIM" | "SAVE" | "IGNORE";
  reason: string;
  aiAnalysis?: ArticleAnalysis;
};

export type ReportData = {
  date: string;
  generatedAt: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  items: ClassifiedItem[];
  keywords: string[];
  aiSummary: string;
};
