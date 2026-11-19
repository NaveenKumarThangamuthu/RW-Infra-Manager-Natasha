"use client";
import Link from "next/link";
import { GitBranch, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconWell, PageHeader, Screen } from "@/components/natasha/primitives";

const FEATURES = [
  { icon: ShieldCheck, title: "Vulnerable dependencies", body: "Every repository is checked for libraries with known security issues." },
  { icon: KeyRound, title: "Secrets in code", body: "Passwords, keys and tokens committed by mistake are flagged, with the value hidden." },
  { icon: GitBranch, title: "One list for every repository", body: "Scan status and open findings for each repository, with failed scans shown first." },
];

export function NotConnected() {
  return (
    <Screen label="Repositories">
      <PageHeader title="Repositories" description="Connect a GitHub account to list its repositories and scan them for vulnerable dependencies and secrets." />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
        {FEATURES.map((f) => (
          <Card key={f.title} className="flex flex-col gap-2.5 px-5 py-[18px]">
            <IconWell color="var(--brand)"><f.icon size={16} className="block" /></IconWell>
            <div className="text-[14px] font-semibold">{f.title}</div>
            <div className="text-[13px] leading-[1.5] text-muted-foreground">{f.body}</div>
          </Card>
        ))}
      </div>
      <Card className="flex flex-col items-center gap-3 px-5 py-10 text-center">
        <h2 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">Connect GitHub to get started</h2>
        <p className="m-0 max-w-[480px] text-[13px] leading-[1.5] text-muted-foreground">
          You sign in on GitHub and approve access; no token is copied by hand. The access key is stored encrypted on the server.
        </p>
        <Button asChild variant="primary" size="lg" className="px-4"><Link href="/security/connect" className="no-underline">Connect with GitHub</Link></Button>
      </Card>
    </Screen>
  );
}
