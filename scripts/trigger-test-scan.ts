/**
 * One-shot helper to trigger a scan against the smallest available repo for
 * the connected user. Used for local backend verification — confirms the
 * scanRepo() pipeline (clone -> Trivy + Gitleaks -> finding upserts) works
 * end-to-end. Not part of the running app.
 */
import { prisma } from "../lib/db";
import { listRepos, resolveScanBranches, getMe } from "../lib/github";
import { readToken } from "../lib/githubVault";
import { scanRepo } from "../lib/scanRepo";

async function main() {
  const email = process.env.SCAN_AS_EMAIL;
  if (!email) throw new Error("SCAN_AS_EMAIL env var required");

  const tok = await readToken(email);
  if (!tok) throw new Error(`No active GitHub connection for ${email}`);

  const me = await getMe(tok.token);
  console.log(`GitHub user: ${me.login} (${me.public_repos} public, ${me.total_private_repos ?? "?"} private)`);

  const all = await listRepos(tok.token, 200);
  const active = all.filter((r) => !r.archived);

  const want = process.env.SCAN_REPO;
  let target;
  if (want) {
    target = active.find((r) => r.full_name === want || r.name === want);
    if (!target) throw new Error(`Repo ${want} not found in accessible list (got ${active.length} repos).`);
  } else {
    target = active[0];
  }
  if (!target) throw new Error("No repo selected.");
  console.log(`Selected: ${target.full_name} (default=${target.default_branch})`);

  const branches = await resolveScanBranches(tok.token, [{
    owner: target.owner.login, name: target.name, default_branch: target.default_branch,
  }]);
  const branch = branches.get(target.full_name) ?? target.default_branch;
  console.log(`Scan branch: ${branch}`);

  console.log("Running scanRepo()...");
  const t0 = Date.now();
  const out = await scanRepo({
    triggeredBy: email,
    owner: target.owner.login,
    name: target.name,
    branch,
    trigger: "manual",
  });
  const dt = Date.now() - t0;
  console.log(JSON.stringify(out, null, 2));
  console.log(`Wall time: ${dt}ms`);
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
