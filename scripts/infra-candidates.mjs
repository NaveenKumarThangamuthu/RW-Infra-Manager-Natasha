// Find RW-TEAM-AI repos that *look* like infra (by name/description/topics) so they
// can be tagged with topic:infra on GitHub. Read-only — does not modify GitHub.
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "node:crypto";

const prisma = new PrismaClient();
const key = Buffer.from(process.env.INFRA_KMS_KEY ?? "", "base64");
const conn = await prisma.githubConnection.findFirst({ orderBy: { id: "desc" } });
const d = createDecipheriv("aes-256-gcm", key, conn.iv);
d.setAuthTag(conn.authTag);
const tok = Buffer.concat([d.update(conn.cipher), d.final()]).toString("utf8");

const H = {
  Authorization: `Bearer ${tok}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "natasha-probe/1.0",
};

const me = await (await fetch("https://api.github.com/user", { headers: H })).json();
console.log(`Authenticated as: ${me.login}`);
const scopesHdr = (await fetch("https://api.github.com/user", { headers: H, method: "HEAD" })).headers.get("x-oauth-scopes");
console.log(`OAuth scopes: ${scopesHdr}`);

const all = [];
let url = "https://api.github.com/user/repos?per_page=100&affiliation=organization_member";
while (url && all.length < 500) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) break;
  const page = await r.json();
  all.push(...page);
  const link = r.headers.get("link") ?? "";
  const m = link.split(",").map(s => s.trim()).find(p => p.endsWith('rel="next"'));
  url = m ? m.replace(/^<|>; rel="next"$/g, "") : "";
}

const RW = all.filter(r => r.owner.login === "RW-TEAM-AI");
console.log(`\nTotal RW-TEAM-AI repos visible: ${RW.length}`);

const RX = /(infra|devops|terraform|helm|k8s|kube|docker|ansible|jenkins|cicd|ci-cd|deploy|aws|gcp|azure|cluster|platform|gateway|nginx|argocd|vault|grafana|prometheus|sre|ops|pipeline|cdk|pulumi)/i;
const candidates = RW.filter(r => RX.test(r.name) || RX.test(r.description ?? ""))
  .sort((a,b)=>a.name.localeCompare(b.name));

console.log(`\n=== Likely infra repos (${candidates.length}) — apply 'infra' topic to these on GitHub ===`);
for (const r of candidates) {
  const desc = (r.description || "").slice(0, 70);
  console.log(`  ${r.full_name.padEnd(45)} ${desc}`);
}
console.log("\n=== gh CLI bulk-tag command (read it before running) ===");
console.log("# Requires:  gh auth login   (with 'repo' scope)");
for (const r of candidates) {
  console.log(`gh api -X PUT repos/${r.full_name}/topics -F names[]=infra ${r.topics?.length ? r.topics.map(t=>`-F names[]=${t}`).join(' ') : ''}`);
}

await prisma.$disconnect();
