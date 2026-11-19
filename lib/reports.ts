import fs from "fs";
import path from "path";

export type ReportKind = "pdf" | "csv" | "html";
export interface ReportEntry {
  id: string;
  title: string;
  kind: ReportKind;
  sizeBytes: number;
  modifiedAt: string;
  viewUrl: string;
  downloadUrl: string;
  downloadName: string;
  /** Word shown before the file date in the list; "Added" when absent. */
  dateLabel?: string;
  alt?: { label: string; url: string };
}
export interface ReportFile { name: string; kind: ReportKind; sizeBytes: number; modifiedAt: Date }

export const REPORTS_DIR = path.join(process.cwd(), "data", "reports");
const KIND_BY_EXT: Record<string, ReportKind> = { ".pdf": "pdf", ".csv": "csv", ".html": "html", ".htm": "html" };
export const CONTENT_TYPE: Record<ReportKind, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
};
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;
const TITLES: Record<string, string> = {
  "RCA-ES-2026-11-11-Elasticsearch-CPU.pdf": "RCA: Elasticsearch CPU, 11 Nov 2026",
  "events_statements_summary_by_digest_202611041158.csv": "MySQL statement digests, 4 Nov 2026",
};

export function titleFromName(name: string): string {
  const known = TITLES[name];
  const base = name.replace(/\.[^.]+$/, "");
  const spaced = base.replace(/(?<!\d)-|-(?!\d)/g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return known ?? spaced;
}

async function toFile(d: fs.Dirent): Promise<ReportFile | null> {
  const kind = KIND_BY_EXT[path.extname(d.name).toLowerCase()];
  let result: ReportFile | null = null;
  if (d.isFile() && SAFE_NAME.test(d.name) && kind) {
    const st = await fs.promises.stat(path.join(REPORTS_DIR, d.name));
    result = { name: d.name, kind, sizeBytes: st.size, modifiedAt: st.mtime };
  }
  return result;
}

export async function listReportFiles(): Promise<ReportFile[]> {
  let result: ReportFile[] = [];
  try {
    const dirents = await fs.promises.readdir(REPORTS_DIR, { withFileTypes: true });
    const files = await Promise.all(dirents.map(toFile));
    result = files.filter((f): f is ReportFile => f !== null);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return result;
}

/** The client-supplied name is only compared with readdir results, never joined into a path. */
export async function findReportFile(name: string): Promise<ReportFile | null> {
  const files = await listReportFiles();
  return files.find((f) => f.name === name) ?? null;
}

async function statOrNull(p: string): Promise<fs.Stats | null> {
  return fs.promises.stat(p).catch(() => null);
}

async function vulnerabilityReport(): Promise<ReportEntry | null> {
  const st = await statOrNull(path.join(process.cwd(), "public", "vulnerability-report.html"));
  let entry: ReportEntry | null = null;
  if (st) {
    const pdf = await statOrNull(path.join(process.cwd(), "public", "vulnerability-report.pdf"));
    entry = {
      id: "vulnerability-report",
      title: "Vulnerability report",
      kind: "html",
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
      viewUrl: "/vulnerability-report.html",
      downloadUrl: "/vulnerability-report.html",
      downloadName: "vulnerability-report.html",
      dateLabel: "Generated",
      ...(pdf ? { alt: { label: "PDF version", url: "/vulnerability-report.pdf" } } : {}),
    };
  }
  return entry;
}

function toEntry(f: ReportFile): ReportEntry {
  const viewUrl = `/api/reports/file?name=${encodeURIComponent(f.name)}`;
  return {
    id: f.name,
    title: titleFromName(f.name),
    kind: f.kind,
    sizeBytes: f.sizeBytes,
    modifiedAt: f.modifiedAt.toISOString(),
    viewUrl,
    downloadUrl: `${viewUrl}&download=1`,
    downloadName: f.name,
  };
}

export async function listReports(): Promise<ReportEntry[]> {
  const [files, vuln] = await Promise.all([listReportFiles(), vulnerabilityReport()]);
  const entries = files.map(toEntry);
  if (vuln) entries.push(vuln);
  return entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
