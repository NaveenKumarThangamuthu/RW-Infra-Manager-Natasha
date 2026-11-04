import type { LucideIcon } from "lucide-react";

interface StubCard { label: string; body: string }

interface StubPageProps {
  title: string;
  tag: string;
  subtitle: string;
  Icon?: LucideIcon;
  cards: StubCard[];
}

export default function StubPage({ title, tag, subtitle, Icon, cards }: StubPageProps) {
  return (
    <>
      <div className="stub-hero">
        <div className="stub-tag">
          {Icon ? <Icon size={12} strokeWidth={2} /> : null}
          {tag}
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <p className="muted-soft" style={{ marginTop: 6, fontSize: 12 }}>
          Wiring live data into this page is on the way — the layout below reflects the shape the
          production view will take.
        </p>
      </div>
      <div className="stub-cards">
        {cards.map((c) => (
          <div key={c.label} className="stub-card">
            <div className="stub-card-label">{c.label}</div>
            <div className="stub-card-body">{c.body}</div>
          </div>
        ))}
      </div>
    </>
  );
}
