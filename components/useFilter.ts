"use client";
import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * URL-state hook for dashboard filters. Updates the query string in place
 * (shallow nav) so deep links are shareable and Back/Forward work.
 *
 * Usage:
 *   const [filters, setFilters] = useFilter({ month: "", region: "", tag: "" });
 *   setFilters({ region: "us-east-1" })          // merges, removes empties
 *   filters.region                                // current value (string)
 */
export function useFilter<K extends string>(defaults: Record<K, string>): [
  Record<K, string>,
  (patch: Partial<Record<K, string>>) => void,
] {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = {} as Record<K, string>;
  for (const k in defaults) {
    current[k] = sp.get(k) ?? defaults[k];
  }

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const params = new URLSearchParams(sp.toString());
      for (const k in patch) {
        const v = patch[k];
        if (v == null || v === "" || v === defaults[k as K]) params.delete(k);
        else params.set(k, v as string);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, sp, defaults],
  );

  return [current, set];
}
