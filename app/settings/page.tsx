"use client";
import { useSession } from "next-auth/react";
import { useJson } from "@/components/useJson";
import { Settings as SettingsIcon, KeyRound, Bell, DollarSign, Cog, Clock } from "lucide-react";
import { money } from "@/components/format";
import AllowedUsersPanel from "@/components/AllowedUsersPanel";
import AppearancePanel from "@/components/AppearancePanel";
import SecretsPanel from "@/components/SecretsPanel";

interface DashResp {
  ops?: {
    cronLastRunAt?: string | null;
    snapshotAges?: Record<string, string | null>;
  };
}
interface AllocResp { byCategory?: Record<string, number>; categoryCounts?: Record<string, number> }

const CAT_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: "2.0", label: "2.0", color: "#38bdf8" },
  { key: "3.0", label: "3.0", color: "#a78bfa" },
  { key: "Infra", label: "Infra", color: "#f59e0b" },
  { key: "Dev", label: "Dev", color: "#f472b6" },
  { key: "Shared", label: "Shared", color: "#34d399" },
];

// Default budgets — real values are read from TAG_BUDGETS_JSON on the server.
const DEFAULT_BUDGETS: Record<string, number> = { "2.0": 800, "3.0": 600, "Infra": 300, "Dev": 150, "Shared": 100 };

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const bg = clamped >= 100 ? "#ef4444" : clamped >= 80 ? "#facc15" : color;
  return (
    <div className="settings-pb">
      <div className="settings-pb-fill" style={{ width: `${Math.min(100, clamped)}%`, background: bg }} />
      <span className="settings-pb-label">{clamped.toFixed(0)}%</span>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: alloc } = useJson<AllocResp>("/api/cost/allocation");
  const { data: dash } = useJson<DashResp>("/api/dashboard/summary");

  const email = session?.user?.email ?? "—";
  const cronAt = dash?.ops?.cronLastRunAt ? new Date(dash.ops.cronLastRunAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }) : "—";

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Profile, budgets, cron schedule, and anomaly thresholds.</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel settings-panel">
          <div className="settings-head"><KeyRound size={14} /> Profile</div>
          <div className="settings-row"><span className="settings-label">Signed in as</span><span className="settings-val mono">{email}</span></div>
          <div className="settings-row"><span className="settings-label">Session</span><span className="settings-val">NextAuth (JWT · 30-day rolling)</span></div>
          <div className="settings-row"><span className="settings-label">Provider</span><span className="settings-val">Google Sign-In only</span></div>
        </div>

        <AppearancePanel />

        <SecretsPanel />

        <AllowedUsersPanel />

        <div className="panel settings-panel">
          <div className="settings-head"><DollarSign size={14} /> Categories &amp; budgets</div>
          <div className="settings-note">Configured via <span className="mono">TAG_BUDGETS_JSON</span> in <span className="mono">/tmp/srv.env</span>. Live progress bars use this month's spend.</div>
          {CAT_ORDER.map((c) => {
            const spent = alloc?.byCategory?.[c.key] ?? 0;
            const budget = DEFAULT_BUDGETS[c.key] ?? 0;
            const pct = budget > 0 ? (spent / budget) * 100 : 0;
            return (
              <div key={c.key} className="settings-budget-row">
                <div className="settings-budget-head">
                  <span className="cat-swatch-dot" style={{ background: c.color }} />
                  <span className="settings-budget-name">{c.label}</span>
                  <span className="settings-budget-nums tab-num muted small">{money(spent)} / {money(budget)}/mo</span>
                </div>
                <ProgressBar pct={pct} color={c.color} />
              </div>
            );
          })}
        </div>

        <div className="panel settings-panel">
          <div className="settings-head"><Clock size={14} /> Cron schedule</div>
          <div className="settings-row"><span className="settings-label">Last run</span><span className="settings-val mono">{cronAt} IST</span></div>
          <div className="settings-row"><span className="settings-label">Schedule</span><span className="settings-val">Twice-daily · 00:30 &amp; 12:30 UTC</span></div>
          <div className="settings-row"><span className="settings-label">Script</span><span className="settings-val mono">scripts/cron-refresh.sh</span></div>
          <div className="settings-note">Chains <span className="mono">/api/cron/refresh-all</span> (ops) + <span className="mono">/api/refresh</span> (billing). Each call logs independently; a failure in one no longer skips the other.</div>
        </div>

        <div className="panel settings-panel">
          <div className="settings-head"><Cog size={14} /> Anomaly thresholds</div>
          <div className="settings-row"><span className="settings-label">Detection</span><span className="settings-val">MAD z-score over 14-day baseline</span></div>
          <div className="settings-row"><span className="settings-label">Warn threshold</span><span className="settings-val tab-num">z ≥ 2.0</span></div>
          <div className="settings-row"><span className="settings-label">Crit threshold</span><span className="settings-val tab-num">z ≥ 3.0</span></div>
          <div className="settings-row"><span className="settings-label">Min $ impact</span><span className="settings-val tab-num">$25 default (<span className="mono">TELEGRAM_ALERT_MIN_USD</span>)</span></div>
        </div>

        <div className="panel settings-panel">
          <div className="settings-head"><Bell size={14} /> Alerts</div>
          <div className="settings-row"><span className="settings-label">Anomaly alerts</span><span className="settings-val">Telegram · Infra topic 61</span></div>
          <div className="settings-row"><span className="settings-label">Cron summary</span><span className="settings-val">Silent unless anomalies or CRIT findings</span></div>
          <div className="settings-row"><span className="settings-label">Suppression</span><span className="settings-val">Findings can be suppressed per-repo with audit trail</span></div>
        </div>

        <div className="panel settings-panel">
          <div className="settings-head"><SettingsIcon size={14} /> About</div>
          <div className="settings-row"><span className="settings-label">App</span><span className="settings-val">Natasha Infra Command Center</span></div>
          <div className="settings-row"><span className="settings-label">Stack</span><span className="settings-val">Next.js 14 · React 18 · Prisma 5 · MySQL 8.4</span></div>
          <div className="settings-row"><span className="settings-label">AI</span><span className="settings-val">claude-fable-5 · text + structured outputs</span></div>
          <div className="settings-row"><span className="settings-label">Data</span><span className="settings-val">Read-only · every telemetry snapshot preserved</span></div>
        </div>
      </div>
    </>
  );
}
