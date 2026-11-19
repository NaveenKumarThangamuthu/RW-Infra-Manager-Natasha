/**
 * Log level of a Spring log line, read from the line's own prefix.
 *
 * The ELK stream has no level field, and matching the word "ERROR" anywhere in
 * the message also catches INFO lines that merely mention an error (for example
 * "ResultDTO [..., errorMessage=null]" or "500 INTERNAL_SERVER_ERROR"), which
 * made unrelated services look as if they shared the same errors. The level is
 * the first level word among the first four tokens:
 *   2026-11-19 08:12:18.951 ERROR [thread] ...
 *   2026-11-19T08:11:24.916Z  INFO 5769 --- [thread] ...
 */
const LEVEL_SCRIPT = `
String m = params._source.message;
if (m == null) { return; }
String head = m.length() > 64 ? m.substring(0, 64) : m;
String[] t = head.splitOnToken(' ');
int seen = 0;
for (int i = 0; i < t.length && seen < 4; i++) {
  if (t[i].length() == 0) { continue; }
  seen++;
  if (t[i] == 'ERROR' || t[i] == 'FATAL') { emit('ERROR'); return; }
  if (t[i] == 'WARN' || t[i] == 'WARNING') { emit('WARN'); return; }
  if (t[i] == 'INFO' || t[i] == 'DEBUG' || t[i] == 'TRACE') { emit('OTHER'); return; }
}`;

export const LOG_LEVEL_FIELD = "log_level";

/** Add as `runtime_mappings` to any search that uses `levelFilters`. */
export const LOG_LEVEL_RUNTIME = { [LOG_LEVEL_FIELD]: { type: "keyword", script: { source: LEVEL_SCRIPT } } };

/**
 * Filters for lines of one level. The cheap word match comes first, so the
 * scripted field is only computed for the few lines that contain the word.
 * Use these in the top-level query, not inside an aggregation.
 */
export function levelFilters(level: "ERROR" | "WARN"): object[] {
  return [{ match_phrase: { message: level } }, { term: { [LOG_LEVEL_FIELD]: level } }];
}
