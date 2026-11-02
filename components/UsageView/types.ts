/** Response types of GET /api/usage */

export type UsageDays = 7 | 30;

export interface UsageWindow {
  /** null = window has reset or the value is stale */
  usedPercent: number | null;
  resetsAt: number;
  windowMinutes?: number;
}

export type UsageLimitSource = 'statusline' | 'claude-cache' | 'rollout';

export interface UsageLimits {
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  source: UsageLimitSource;
  asOf: number;
  plan?: string;
}

export interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageTotals extends UsageTokens {
  total: number;
}

export interface UsageDaily extends UsageTokens {
  /** YYYY-MM-DD */
  date: string;
  model: string;
}

export interface UsageProvider {
  id: string;
  label: string;
  kind: 'claude' | 'codex' | string;
  available: boolean;
  /** null = no limit source for this provider (e.g. MiniMax) */
  limits: UsageLimits | null;
  totals: UsageTotals;
  cacheHitRate: number | null;
  daily: UsageDaily[];
}

export interface UsageResponse {
  generatedAt: number;
  days: number;
  providers: UsageProvider[];
}
