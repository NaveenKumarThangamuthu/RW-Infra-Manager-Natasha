"use client";

export interface FilterSelect {
  key: string;
  label: string;
  value: string;
  /** option values; an "All <label>" entry is prepended automatically */
  options: string[];
  onChange: (v: string) => void;
}

interface Props {
  selects?: FilterSelect[];
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  shown: number;
  total: number;
  onReset: () => void;
}

/** Reusable filter bar: labeled dropdowns + a search box + result count / reset. */
export default function FilterBar({ selects = [], search, shown, total, onReset }: Props) {
  const active =
    (search?.value?.length ?? 0) > 0 || selects.some((s) => s.value && s.value !== "");

  return (
    <div className="filterbar">
      {selects.map((s) => (
        <div className="filter-field" key={s.key}>
          <label>{s.label}</label>
          <select value={s.value} onChange={(e) => s.onChange(e.target.value)}>
            <option value="">All {s.label.toLowerCase()}</option>
            {s.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      ))}

      {search && (
        <div className="filter-field filter-search">
          <label>Search</label>
          <input
            type="text"
            value={search.value}
            placeholder={search.placeholder ?? "Search…"}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </div>
      )}

      <div className="filter-meta">
        <span className="filter-count">
          Showing <strong>{shown}</strong> of {total}
        </span>
        {active && (
          <button className="btn-ghost" onClick={onReset}>Clear filters</button>
        )}
      </div>
    </div>
  );
}

/** Sorted unique non-empty values from a list — for building select options. */
export function uniq<T>(items: T[], pick: (t: T) => string | undefined | null): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const v = pick(it);
    if (v && v !== "-") set.add(v);
  }
  return [...set].sort();
}
