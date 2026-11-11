export interface DeltaItem { key: string; amount: number; unit: string; prev: number; deltaPct: number | null }
export interface SummaryResp {
  month: string | null;
  range: { Start: string; End: string };
  isCurrentMonth: boolean;
  mtdTotal: number;
  last7: number;
  avgPerDay: number;
  projectedMonth: number | null;
  forecastRest: number | null;
  topServices: DeltaItem[];
  topRegions: DeltaItem[];
  trend: Array<{ date: string; amount: number }>;
  prev?: { month: string; total: number; deltaPct: number | null };
  stale?: boolean;
  asOf?: string;
}
export interface MonthlyTotalResp { series: Array<{ month: string; amount: number }> }
