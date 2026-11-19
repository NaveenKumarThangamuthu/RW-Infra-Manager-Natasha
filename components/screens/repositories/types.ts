export interface FindingCounts { total: number; CRIT: number; HIGH: number; MED: number; LOW: number; INFO: number }

export interface Repo {
  id: number; name: string; full_name: string; owner: string;
  private: boolean; fork: boolean; archived: boolean;
  description: string | null; language: string | null;
  pushed_at: string | null; default_branch: string; scan_branch: string; html_url: string;
  stars: number;
  findings?: FindingCounts;
}

export interface ReposResp {
  ok: boolean;
  connected: boolean;
  syncedAt?: string | null;
  archivedHidden?: number;
  archivedCount?: number;
  excludedByAllowlist?: number;
  allowlist?: { source: string; count: number; fetchedAt: string | null; cached: boolean; error: string | null } | null;
  me: { login: string } | null;
  repos: Repo[];
  error?: string;
}

export interface ScanJob {
  id: number;
  repoFullName: string;
  branch: string;
  status: string;
  triggeredBy: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  commitSha: string | null;
  errorMessage: string | null;
  findingsCount: number;
}
export interface ScansResp { ok: boolean; fetchedAt?: string; jobs: ScanJob[]; error?: string }

export interface Finding {
  id: number;
  scanner: string;
  severity: string;
  category: string;
  ruleId: string;
  title: string;
  description: string | null;
  file: string | null;
  line: number | null;
  lastSeenAt: string;
  suppressedAt: string | null;
}
export interface FindingsResp { ok: boolean; fetchedAt?: string; bySeverity: Record<string, number>; total?: number; findings: Finding[]; error?: string }

export type ScanState = "failed" | "running" | "success" | "skipped" | "none";

export const SCAN_META: Record<ScanState, { label: string; color: string }> = {
  failed: { label: "Failed", color: "var(--danger)" },
  running: { label: "Running", color: "var(--info)" },
  success: { label: "Scanned", color: "var(--success)" },
  skipped: { label: "Skipped", color: "var(--muted-fg)" },
  none: { label: "Not scanned", color: "var(--muted-fg)" },
};

export function scanState(job: ScanJob | undefined): ScanState {
  const s = job?.status;
  if (s === "failed" || s === "success" || s === "skipped") return s;
  return s === "running" || s === "queued" ? "running" : "none";
}

export const SEVERITIES = ["CRIT", "HIGH", "MED", "LOW", "INFO"] as const;
export const SEV_META: Record<string, { label: string; color: string }> = {
  CRIT: { label: "Critical", color: "var(--danger)" },
  HIGH: { label: "High", color: "var(--orange)" },
  MED: { label: "Medium", color: "var(--warning)" },
  LOW: { label: "Low", color: "var(--info)" },
  INFO: { label: "Info", color: "var(--muted-fg)" },
};

export const CATEGORY_LABEL: Record<string, string> = {
  CVE: "Vulnerable dependency", SECRET: "Possible secret", IAC: "Configuration", SPRING_HYGIENE: "Spring setup", OTHER: "Other",
};

export const STACK_LABEL: Record<string, string> = {
  spring: "Spring", "vite-vue": "Vite + Vue", vite: "Vite", vue: "Vue", next: "Next.js", react: "React", node: "Node", prisma: "Prisma",
  java: "Java", kotlin: "Kotlin", typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go", rust: "Rust", php: "PHP",
  ruby: "Ruby", docker: "Docker", airflow: "Airflow", mongo: "MongoDB", mysql: "MySQL", redis: "Redis", jenkins: "Jenkins", elasticsearch: "Elastic",
};

/** A short, plain reason for a failed scan. The raw scanner output never reaches the page. */
export function failureReason(message: string | null | undefined): string {
  const m = message ?? "";
  const branch = /Remote branch (\S+) not found/i.exec(m);
  let reason = "The scan could not finish";
  if (branch) reason = `Branch “${branch[1]}” does not exist in this repository`;
  else if (/repository not found|not found/i.test(m)) reason = "Repository not found on GitHub";
  else if (/HTTP 5\d\d|early EOF|timed? ?out|RPC failed/i.test(m)) reason = "Download from GitHub was interrupted";
  else if (/killed|interrupted/i.test(m)) reason = "The scan was stopped before it finished";
  else if (/authentication|permission|denied|403/i.test(m)) reason = "GitHub refused access to this repository";
  return reason;
}

export function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export const PAGE_SIZE = 25;
