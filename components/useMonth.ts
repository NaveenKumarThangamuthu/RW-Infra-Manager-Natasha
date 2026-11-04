"use client";
import { useSearchParams } from "next/navigation";

/** Current "YYYY-MM" from the URL, or "" meaning the current calendar month. */
export function useMonthParam(): string {
  const sp = useSearchParams();
  return sp.get("month") ?? "";
}

/** Append ?month= to an API url when a month is selected. */
export function withMonth(url: string, month: string): string {
  return month ? `${url}?month=${encodeURIComponent(month)}` : url;
}
