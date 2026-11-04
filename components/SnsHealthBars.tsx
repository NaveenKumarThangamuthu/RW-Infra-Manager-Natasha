"use client";
import { useJson } from "./useJson";
import { money } from "./format";
import { Mail, MessageSquare, Smartphone, Radio, Sparkles } from "lucide-react";

interface Topic { arn: string; name: string; cost: number; unit: string }
interface UsageRow { resourceAndUsage: string; usageType: string; cost: number }
interface SnsResp { topics?: Topic[]; usage?: UsageRow[]; total?: number }

interface ChannelBucket { label: string; cost: number; icon: React.ReactNode; color: string }

function classifyChannel(usageType: string): { label: string; icon: React.ReactNode; color: string } {
  const s = usageType.toLowerCase();
  if (s.includes("sms")) return { label: "SMS", icon: <Smartphone size={14} />, color: "#f472b6" };
  if (s.includes("http") || s.includes("https")) return { label: "HTTP delivery", icon: <Radio size={14} />, color: "#38bdf8" };
  if (s.includes("email") || s.includes("smtp")) return { label: "Email", icon: <Mail size={14} />, color: "#a78bfa" };
  if (s.includes("request") || s.includes("api")) return { label: "API requests", icon: <MessageSquare size={14} />, color: "#34d399" };
  return { label: "Other", icon: <Radio size={14} />, color: "#94a3b8" };
}

export default function SnsHealthBars() {
  const { data } = useJson<SnsResp>("/api/cost/sns");
  if (!data) return null;

  const topics = data.topics ?? [];
  const usage = data.usage ?? [];

  const byChannel = new Map<string, ChannelBucket>();
  for (const u of usage) {
    const c = classifyChannel(u.usageType);
    const bucket = byChannel.get(c.label) ?? { label: c.label, cost: 0, icon: c.icon, color: c.color };
    bucket.cost += u.cost;
    byChannel.set(c.label, bucket);
  }
  const channels = [...byChannel.values()].sort((a, b) => b.cost - a.cost);
  const chanMax = Math.max(0.01, ...channels.map((c) => c.cost));

  const topicMax = Math.max(0.01, ...topics.map((t) => t.cost));

  return (
    <>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="panel">
          <div className="panel-head">
            <h2>Delivery channels · notification health</h2>
            <span className="chip">{money(data.total ?? 0)} last 14 days</span>
          </div>
          {channels.length === 0 ? (
            <div className="empty">No channel breakdown yet.</div>
          ) : (
            <div className="sns-channels">
              {channels.map((c) => {
                const pct = (c.cost / chanMax) * 100;
                return (
                  <div key={c.label} className="sns-channel-row">
                    <div className="sns-channel-head">
                      <span className="sns-channel-icon" style={{ color: c.color, background: `${c.color}22` }}>{c.icon}</span>
                      <span className="sns-channel-name">{c.label}</span>
                      <span className="sns-channel-cost tab-num">{money(c.cost)}</span>
                    </div>
                    <div className="sns-channel-bar">
                      <div className="sns-channel-fill" style={{ width: `${pct}%`, background: c.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Top topics by cost</h2>
            <span className="chip">{topics.length} topic{topics.length === 1 ? "" : "s"}</span>
          </div>
          {topics.length === 0 ? (
            <div className="empty">No SNS topics yet.</div>
          ) : (
            <div className="sns-topics">
              {topics.slice(0, 10).map((t) => {
                const pct = (t.cost / topicMax) * 100;
                return (
                  <div key={t.arn} className="sns-topic-row">
                    <div className="sns-topic-head">
                      <span className="sns-topic-name mono small">{t.name}</span>
                      <span className="sns-topic-cost tab-num">{money(t.cost)}</span>
                    </div>
                    <div className="sns-topic-bar">
                      <div className="sns-topic-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {channels.length > 0 && (
        <div className="fable-triage" style={{ marginTop: 12 }}>
          <div className="fable-triage-head"><Sparkles size={13} /> Fable notification insight <span className="model-chip">claude-fable-5</span></div>
          <div className="fable-triage-fix">
            {channels[0].label === "SMS" && channels[0].cost > 20
              ? `SMS accounts for ${money(channels[0].cost)} — the most expensive channel at ~$0.75/1k. If any high-volume topic can move to HTTP delivery to a webhook, expect a 90%+ savings.`
              : `${channels[0].label} is your dominant channel at ${money(channels[0].cost)}. ${channels.length > 1 ? channels[1].label + " is next at " + money(channels[1].cost) + "." : ""}`}
          </div>
        </div>
      )}
    </>
  );
}
