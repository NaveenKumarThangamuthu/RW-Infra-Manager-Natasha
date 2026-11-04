/**
 * Tiny CSV export helper. RFC-4180-ish quoting; handles numbers, strings,
 * and null/undefined. No deps.
 */

export interface CsvColumn<T> {
  key: keyof T;
  label: string;
}

function escape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends object>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escape((row as Record<string, unknown>)[c.key as string])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

function withTimestamp(filename: string): string {
  // Inject -YYYY-MM-DD before the extension so re-downloads don't overwrite.
  const stamp = new Date().toISOString().slice(0, 10);
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return `${filename}-${stamp}`;
  return `${filename.slice(0, dot)}-${stamp}${filename.slice(dot)}`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = withTimestamp(filename);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 100);
}
