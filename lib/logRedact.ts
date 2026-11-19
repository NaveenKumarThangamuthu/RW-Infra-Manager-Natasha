/**
 * Redaction for raw log text (Spring/ELK, Loki, CloudWatch) before it is sent to the browser.
 * Composes the slow-queries redactor (emails, IPv4, quoted values, tokens, DTO dumps) with rules
 * for things general service logs carry: URLs and host names, server file paths, AS2 message ids,
 * transferred file names and long numeric ids. No I/O.
 */
import { redact } from "@/lib/slowQueryParse";

// scheme://host[:port] — the path is kept (it names the endpoint), the query string is dropped.
const URL_RE = /\bhttps?:\/\/[^\s/'"<>)\]]+((?:\/[^\s?'"<>)\]]*)?)(\?[^\s'"<>)\]]*)?/gi;
// EC2-style internal host names: ip-172-31-0-36[.region.compute.internal]
const EC2_HOST = /\bip-\d{1,3}(?:-\d{1,3}){3}(?:\.[\w.-]+)?/g;
// Bare DNS names with a common suffix. The lookarounds keep Java package names intact.
const DNS_HOST = /(?<![\w.@/-])(?:[a-z0-9-]+\.)+(?:com|net|org|io|internal|local)(?::\d+)?(?![\w-]|\.\w)/g;
// <local@domain> message ids (AS2 / MIME) carry partner ids that have no dot, so the email rule misses them.
const MESSAGE_ID = /<[^<>\s@]+@[^<>\s]+>/g;
// Absolute server paths under the usual roots.
const FILE_PATH = /(?<![\w.>])\/(?:opt|home|var|usr|etc|tmp|data|mnt|srv|root|apps?)\/[^\s'"<>,;)\]]*/g;
// Transferred documents.
const FILE_NAME = /[\w.+-]+\.(?:edi|x12|dat|csv|xml|pdf|xlsx?|zip)\b/gi;
// Order, invoice and customer numbers. Dates, times and ports are shorter and stay.
const LONG_ID = /\b\d{6,}\b/g;

/** Full redaction for one log message. */
export function redactLog(message: string | null | undefined): string {
  if (!message) return "";
  const pre = message
    .replace(MESSAGE_ID, "<message-id>")
    .replace(URL_RE, (_m, path: string | undefined, query: string | undefined) => `<host>${path ?? ""}${query ? "?…" : ""}`)
    .replace(EC2_HOST, "<host>")
    .replace(DNS_HOST, "<host>")
    .replace(FILE_PATH, "<path>")
    .replace(FILE_NAME, "<file>");
  return redact(pre).replace(LONG_ID, "<id>");
}
