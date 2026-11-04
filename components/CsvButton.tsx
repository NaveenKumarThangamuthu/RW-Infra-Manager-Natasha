"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { toCsv, downloadCsv, type CsvColumn } from "./csv";

interface Props<T> {
  rows: T[];
  columns: CsvColumn<T>[];
  filename: string;
  label?: string;
}

/**
 * Drop-in CSV export button for any table. Generates the file client-side —
 * no server round-trip, no extra route to maintain.
 *
 * Usage:
 *   <CsvButton rows={data.rows} filename="ec2.csv" columns={[
 *     { key: "instanceId", label: "Instance ID" },
 *     { key: "name", label: "Name" },
 *     ...
 *   ]} />
 */
export default function CsvButton<T extends object>({ rows, columns, filename, label = "Export CSV" }: Props<T>) {
  const [done, setDone] = useState(false);

  function onClick() {
    if (!rows || rows.length === 0) return;
    const csv = toCsv(rows, columns);
    downloadCsv(filename, csv);
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  }

  return (
    <button
      className="btn-csv"
      onClick={onClick}
      disabled={!rows || rows.length === 0}
      title={`Download ${rows?.length ?? 0} rows as CSV`}
    >
      <Download size={13} /> {done ? "Saved ✓" : label}
    </button>
  );
}
