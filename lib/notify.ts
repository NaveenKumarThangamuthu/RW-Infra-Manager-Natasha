/**
 * Telegram alert sender — env-driven, no-op if unconfigured.
 *
 * Required envs:
 *   TELEGRAM_BOT_TOKEN     — bot token from @BotFather
 *   TELEGRAM_CHAT_ID       — chat id (e.g. -1004104213995 for the RW group)
 *
 * Optional envs:
 *   TELEGRAM_TOPIC_ID      — forum topic id (e.g. 61 for the Infra topic)
 *   TELEGRAM_ALERT_MIN_USD — minimum dollar spike to alert on (default 25)
 *
 * The dashboard cron pings sendCronSummary() after every refresh-all run;
 * anomaly callers can use sendAnomalyAlert() directly. All calls are best-effort
 * — failures log but never throw, so the cron never fails because of Telegram.
 */

interface AnomalyLite {
  service: string;
  resourceId: string;
  latestAmount: number;
  baselineMedian: number;
  spikeUsd: number;
  zScore: number;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function targetConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function send(text: string, opts: { silent?: boolean } = {}): Promise<{ ok: boolean; reason?: string }> {
  if (!targetConfigured()) return { ok: false, reason: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set" };
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: opts.silent ?? false,
  };
  if (process.env.TELEGRAM_TOPIC_ID) {
    body.message_thread_id = Number(process.env.TELEGRAM_TOPIC_ID);
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, reason: `HTTP ${resp.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendAnomalyAlert(anomaly: AnomalyLite): Promise<{ ok: boolean; reason?: string }> {
  const text =
    `🚨 <b>Cost anomaly</b>\n` +
    `<code>${escape(anomaly.service)} ${escape(anomaly.resourceId)}</code>\n` +
    `spike: ${fmtMoney(anomaly.spikeUsd)} (z=${anomaly.zScore.toFixed(1)})\n` +
    `${fmtMoney(anomaly.baselineMedian)} median → ${fmtMoney(anomaly.latestAmount)} today`;
  return send(text);
}

interface CronSummary {
  label: string;
  snapshotsOk: number;
  snapshotsFail: number;
  reposSynced: number;
  briefOk: boolean;
  anomalies: AnomalyLite[];
  newFindings: { CRIT: number; HIGH: number };
}

export async function sendCronSummary(summary: CronSummary): Promise<{ ok: boolean; reason?: string }> {
  if (!targetConfigured()) return { ok: false, reason: "not configured" };
  const MIN_SPIKE = envInt("TELEGRAM_ALERT_MIN_USD", 25);
  const significantAnomalies = summary.anomalies.filter((a) => a.spikeUsd >= MIN_SPIKE);

  // Skip noisy success-only runs unless something interesting happened.
  const hasSomething = significantAnomalies.length > 0 || summary.newFindings.CRIT > 0 || summary.snapshotsFail > 0;
  if (!hasSomething) {
    // Silent heartbeat only — no message sent, just OK to keep cron logs clean.
    return { ok: true };
  }

  const lines: string[] = [];
  lines.push(`🛰 <b>Natasha cron — ${escape(summary.label)}</b>`);
  lines.push(`Snapshots: ${summary.snapshotsOk}/${summary.snapshotsOk + summary.snapshotsFail} ok · Repos synced: ${summary.reposSynced}`);

  if (significantAnomalies.length > 0) {
    lines.push(``);
    lines.push(`<b>${significantAnomalies.length} cost anomal${significantAnomalies.length === 1 ? "y" : "ies"}</b> (≥ ${fmtMoney(MIN_SPIKE)})`);
    for (const a of significantAnomalies.slice(0, 5)) {
      lines.push(`• <code>${escape(a.service)} ${escape(a.resourceId)}</code> +${fmtMoney(a.spikeUsd)} (z=${a.zScore.toFixed(1)})`);
    }
    if (significantAnomalies.length > 5) lines.push(`  …and ${significantAnomalies.length - 5} more`);
  }

  if (summary.newFindings.CRIT > 0) {
    lines.push(``);
    lines.push(`🛡 <b>${summary.newFindings.CRIT} new CRIT</b> · ${summary.newFindings.HIGH} new HIGH security findings`);
  }

  if (summary.snapshotsFail > 0) {
    lines.push(``);
    lines.push(`⚠️ ${summary.snapshotsFail} snapshot source${summary.snapshotsFail === 1 ? "" : "s"} failed`);
  }

  return send(lines.join("\n"));
}

export async function sendTest(): Promise<{ ok: boolean; reason?: string }> {
  return send(`✅ <b>Natasha test alert</b>\nIf you see this, Telegram alerts are wired correctly.`, { silent: true });
}

export interface CertAlert {
  distributor: string;
  filename: string;
  owner: "RW" | "PARTNER" | string;
  subject: string;
  notAfter: Date;
  daysLeft: number;
}

export async function sendCertificateAlert(a: CertAlert): Promise<{ ok: boolean; reason?: string }> {
  const cn = (a.subject.match(/CN=([^,]+)/i) || [])[1]?.trim() || "(no CN)";
  const lines = [
    `🟡 <b>Certificate expiry alert</b>`,
    `<b>Distributor:</b> ${escape(a.distributor)}`,
    `<b>File:</b> <code>${escape(a.filename)}</code>`,
    `<b>Owner:</b> ${a.owner === "RW" ? "🟢 RW" : "🔵 Partner"} — ${escape(cn)}`,
    `<b>Expires:</b> ${a.notAfter.toISOString().slice(0, 10)} (${a.daysLeft} days)`,
    ``,
    `Impact: AS2 EDI flow with this partner will fail after expiry.`,
    `Action: request the renewal cert and drop it into the same Drive folder — /certificates will re-scan.`,
  ];
  return send(lines.join("\n"));
}
