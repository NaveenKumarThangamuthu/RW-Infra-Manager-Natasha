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
  alt?: { label: string; url: string };
}

export interface ReportsResp { ok: true; reports: ReportEntry[] }

export const KIND_META: Record<ReportKind, { label: string; color: string }> = {
  pdf: { label: "PDF", color: "var(--danger)" },
  csv: { label: "CSV", color: "var(--success)" },
  html: { label: "HTML", color: "var(--info)" },
};
