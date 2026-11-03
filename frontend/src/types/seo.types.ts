export type KeywordIntent = "Trans" | "Comm" | "Info" | "Nav";

export interface KeywordItem {
  id: string;
  keyword: string;
  volume: number;
  cpc: number;
  competition: number; // 0.00 - 1.00
  score: number;       // 0 - 100 difficulty/opportunity score
  intent: KeywordIntent;
  source: string;      // e.g. "Google"
}

export interface KeywordClusterSummary {
  name: string;
  score: number;
  volume: number;
  cpc: number;
  competition: number;
  intent: KeywordIntent;
}

export interface SearchTrendPoint {
  month: string;       // e.g. "Dec 25", "Jan 26"
  volume: number;
}

export interface SerpOrganicResult {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
}

export interface RecentSearchItem {
  id: string;
  query: string;
  country: string;
  location: string;
  currency: string;
  createdAt: string;
}

export interface KeywordSearchResponse {
  query: string;
  country: string;
  location: string;
  currency: string;
  cluster: KeywordClusterSummary;
  keywords: KeywordItem[];
  total: number;
  trends: SearchTrendPoint[];
  serp: SerpOrganicResult[];
  cached?: boolean;
}
