export interface DeltaItem { key: string; amount: number; unit: string; prev: number; deltaPct: number | null }
export interface SummaryResp {
  month: string | null;
  range: { Start: string; End: string };
  isCurrentMonth: boolean;
  mtdTotal: number;
  last7: number;
  avgPerDay: number;
  /** Days AWS has finished reporting, and trailing days it is still adding charges to. */
  completeDays?: number;
  partialDays?: number;
  projectedMonth: number | null;
  forecastRest: number | null;
  topServices: DeltaItem[];
  topRegions: DeltaItem[];
  trend: Array<{ date: string; amount: number }>;
  /** `sameDayTotal` is the previous month scaled to the part of the month reported so far. */
  prev?: { month: string; total: number; sameDayTotal?: number; deltaPct: number | null };
  stale?: boolean;
  asOf?: string;
}
export interface MonthlyTotalResp { series: Array<{ month: string; amount: number }> }
