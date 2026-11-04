"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Sparkles } from "lucide-react";

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "You're up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

function niceDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export default function HomeGreeting() {
  const { data: session } = useSession();
  const email = session?.user?.email ?? "";
  const firstName = (session?.user?.name ?? email.split("@")[0] ?? "").split(/[\s.]/)[0] || "there";

  // Compute time client-side; render placeholder until hydration to avoid SSR mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const g = now ? greeting(now) : "Welcome back";
  const dateStr = now ? niceDate(now) : "";
  const capName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return (
    <div className="home-greeting">
      <div>
        <h1 className="home-greeting-title">
          {g}, <span className="home-greeting-name">{capName}</span>
        </h1>
        <div className="home-greeting-sub">
          {dateStr ? <>{dateStr} · </> : null}
          <span className="home-greeting-fable">
            <Sparkles size={12} /> Fable is watching your infra
            <span className="model-chip">claude-fable-5</span>
          </span>
        </div>
      </div>
    </div>
  );
}
