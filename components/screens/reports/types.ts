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
  dateLabel?: string;
  alt?: { label: string; url: string };
}

const TITLE_DATE = /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b|\b\d{4}-\d{2}-\d{2}\b/;
/** The file date is left out when the title already says which day the report is about. */
export function reportDateText(r: ReportEntry, format: (iso: string) => string): string | null {
  return TITLE_DATE.test(r.title) ? null : `${r.dateLabel ?? "Added"} ${format(r.modifiedAt)}`;
}

export interface ReportsResp { ok: true; reports: ReportEntry[] }

export const KIND_META: Record<ReportKind, { label: string; color: string }> = {
  pdf: { label: "PDF", color: "var(--danger)" },
  csv: { label: "CSV", color: "var(--success)" },
  html: { label: "HTML", color: "var(--info)" },
};
