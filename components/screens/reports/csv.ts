const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const LONG_OVER = 60;

/** Single-pass CSV parser: quotes, doubled quotes, and CRLF / LF / CR row ends. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;

  const endField = () => { row.push(field); field = ""; fieldStart = true; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (c === ",") {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
      fieldStart = false;
    }
  }
  if (field !== "" || row.length > 0 || quoted) endRow();
  return rows;
}

export interface Analysed { header: string[]; body: string[][]; numeric: boolean[]; long: boolean[] }

export function analyse(rows: string[][]): Analysed {
  const header = rows[0] ?? [];
  const body = rows.slice(1).map((r) => header.map((_, i) => r[i] ?? ""));
  const numeric = header.map((_, i) => {
    const cells = body.map((r) => r[i]).filter((v) => v !== "");
    return cells.length > 0 && cells.every((v) => NUMERIC.test(v));
  });
  const long = header.map((_, i) => !numeric[i] && body.some((r) => r[i].length > LONG_OVER));
  return { header, body, numeric, long };
}

export function formatNumber(raw: string): string {
  let out = raw;
  if (raw === "") out = "—";
  else {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      out = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
  }
  return out;
}
