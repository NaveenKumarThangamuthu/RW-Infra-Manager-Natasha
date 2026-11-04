"use client";

interface BadgeSpec { key: string; label: string; color: string; bg: string; border: string; icon?: string }

// Core framework/language palette — icon strings kept as unicode / short letters so we don't need SVGs.
const FRAMEWORKS: Record<string, BadgeSpec> = {
  spring:      { key: "spring",     label: "Spring",     color: "#6ee7b7", bg: "rgba(52,211,153,0.10)",  border: "rgba(52,211,153,0.30)", icon: "🌱" },
  "vite-vue":  { key: "vite-vue",   label: "Vite + Vue", color: "#c4b5fd", bg: "rgba(129,140,248,0.10)", border: "rgba(129,140,248,0.30)", icon: "⚡" },
  vite:        { key: "vite",       label: "Vite",       color: "#facc15", bg: "rgba(234,179,8,0.10)",   border: "rgba(234,179,8,0.28)",   icon: "⚡" },
  vue:         { key: "vue",        label: "Vue",        color: "#41b883", bg: "rgba(65,184,131,0.10)",  border: "rgba(65,184,131,0.30)",  icon: "▲" },
  next:        { key: "next",       label: "Next.js",    color: "#e5e7eb", bg: "rgba(229,231,235,0.06)", border: "rgba(229,231,235,0.20)", icon: "▲" },
  react:       { key: "react",      label: "React",      color: "#7dd3fc", bg: "rgba(56,189,248,0.10)",  border: "rgba(56,189,248,0.28)",  icon: "⚛" },
  node:        { key: "node",       label: "Node",       color: "#6ee7b7", bg: "rgba(52,211,153,0.10)",  border: "rgba(52,211,153,0.28)",  icon: "🟢" },
  prisma:      { key: "prisma",     label: "Prisma",     color: "#c4b5fd", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.28)", icon: "◧" },
  java:        { key: "java",       label: "Java",       color: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.28)",  icon: "☕" },
  kotlin:      { key: "kotlin",     label: "Kotlin",     color: "#a78bfa", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.28)", icon: "K" },
  typescript:  { key: "typescript", label: "TypeScript", color: "#38bdf8", bg: "rgba(56,189,248,0.10)",  border: "rgba(56,189,248,0.28)",  icon: "TS" },
  javascript:  { key: "javascript", label: "JavaScript", color: "#facc15", bg: "rgba(234,179,8,0.10)",   border: "rgba(234,179,8,0.28)",   icon: "JS" },
  python:      { key: "python",     label: "Python",     color: "#38bdf8", bg: "rgba(56,189,248,0.10)",  border: "rgba(56,189,248,0.28)",  icon: "🐍" },
  go:          { key: "go",         label: "Go",         color: "#7dd3fc", bg: "rgba(0,173,216,0.10)",   border: "rgba(0,173,216,0.28)",   icon: "Go" },
  rust:        { key: "rust",       label: "Rust",       color: "#f97316", bg: "rgba(249,115,22,0.10)",  border: "rgba(249,115,22,0.28)",  icon: "🦀" },
  php:         { key: "php",        label: "PHP",        color: "#a78bfa", bg: "rgba(79,93,149,0.14)",   border: "rgba(167,139,250,0.28)", icon: "🐘" },
  ruby:        { key: "ruby",       label: "Ruby",       color: "#f472b6", bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.28)", icon: "💎" },
  docker:      { key: "docker",     label: "Docker",     color: "#7dd3fc", bg: "rgba(56,189,248,0.08)",  border: "rgba(56,189,248,0.24)",  icon: "🐳" },
  airflow:     { key: "airflow",    label: "Airflow",    color: "#f472b6", bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.28)", icon: "→" },
  mongo:       { key: "mongo",      label: "MongoDB",    color: "#6ee7b7", bg: "rgba(52,211,153,0.10)",  border: "rgba(52,211,153,0.28)",  icon: "🍃" },
  mysql:       { key: "mysql",      label: "MySQL",      color: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.28)",  icon: "🐬" },
  redis:       { key: "redis",      label: "Redis",      color: "#f87171", bg: "rgba(239,68,68,0.10)",   border: "rgba(239,68,68,0.24)",   icon: "R" },
  jenkins:     { key: "jenkins",    label: "Jenkins",    color: "#f87171", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.24)",   icon: "🛠" },
  elasticsearch:{key: "elasticsearch",label: "Elastic",  color: "#34d399", bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.24)",  icon: "◈" },
};

interface DetectInput {
  language?: string | null;
  name?: string | null;
  fullName?: string | null;
  description?: string | null;
  topics?: string[] | null;
}

/** Return up to 3 badge keys inferred from a repo/service. */
export function detectFrameworks(input: DetectInput): string[] {
  const out = new Set<string>();
  const lang = (input.language ?? "").toLowerCase();
  const name = (input.name ?? input.fullName ?? "").toLowerCase();
  const desc = (input.description ?? "").toLowerCase();
  const topics = (input.topics ?? []).map((t) => t.toLowerCase());
  const hay = `${name} ${desc} ${topics.join(" ")}`;

  // Primary language mapping — one badge from language.
  const LANG_MAP: Record<string, string> = {
    java: "java", kotlin: "kotlin", typescript: "typescript", javascript: "javascript",
    python: "python", go: "go", rust: "rust", php: "php", ruby: "ruby",
  };
  if (LANG_MAP[lang]) out.add(LANG_MAP[lang]);

  // Framework overlays inferred from repo/topic/desc hay.
  if (/vite/.test(hay) && /vue/.test(hay)) out.add("vite-vue");
  else if (/vite/.test(hay)) out.add("vite");
  else if (/vue/.test(hay)) out.add("vue");
  if (/(spring|springboot|spring-boot|boot-starter)/.test(hay)) out.add("spring");
  if (/next\.?js|nextjs/.test(hay)) out.add("next");
  if (/react/.test(hay) && !out.has("next")) out.add("react");
  if (/(node|express|fastify|nest)/.test(hay) && !out.has("next")) out.add("node");
  if (/prisma/.test(hay)) out.add("prisma");
  if (/mongo/.test(hay)) out.add("mongo");
  if (/mysql|mariadb/.test(hay)) out.add("mysql");
  if (/redis/.test(hay)) out.add("redis");
  if (/airflow|dag|orchestrator/.test(hay)) out.add("airflow");
  if (/jenkins/.test(hay)) out.add("jenkins");
  if (/elastic|elk|kibana/.test(hay)) out.add("elasticsearch");
  if (/docker/.test(hay) && out.size === 0) out.add("docker");

  // Java repos → Spring by convention unless we already know they're not.
  if (lang === "java" && !out.has("spring")) out.add("spring");

  // Cap to 3 badges — first 3 in insertion order matter most.
  return [...out].slice(0, 3);
}

export default function FrameworkBadge({ keys, compact = false }: { keys: string[]; compact?: boolean }) {
  if (!keys || keys.length === 0) return null;
  return (
    <span className={`fw-badges ${compact ? "fw-badges-compact" : ""}`}>
      {keys.map((k) => {
        const spec = FRAMEWORKS[k];
        if (!spec) return null;
        return (
          <span
            key={k}
            className="fw-badge"
            style={{ color: spec.color, background: spec.bg, borderColor: spec.border }}
            title={spec.label}
          >
            {spec.icon ? <span className="fw-badge-ico">{spec.icon}</span> : null}
            <span className="fw-badge-label">{spec.label}</span>
          </span>
        );
      })}
    </span>
  );
}
