/**
 * Local scanner runners — Trivy + Gitleaks invoked as subprocesses, output
 * parsed into a common `RawFinding` shape and merged. Scanners run in parallel
 * with a hard per-scanner timeout; one slow tool cannot starve the job.
 */
import { spawn } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const TRIVY_BIN = process.env.NATASHA_TRIVY_BIN || path.join(os.homedir(), "tools/trivy/trivy");
const GITLEAKS_BIN = process.env.NATASHA_GITLEAKS_BIN || path.join(os.homedir(), "tools/gitleaks/gitleaks");
// 4 min per scanner. A kill here silently truncates findings, so bulk runs
// over large repos should raise it via NATASHA_SCAN_TIMEOUT_MS.
const SCAN_TIMEOUT_MS = Number(process.env.NATASHA_SCAN_TIMEOUT_MS) || 240_000;

export type Severity = "CRIT" | "HIGH" | "MED" | "LOW" | "INFO";
export type Category = "CVE" | "SECRET" | "IAC" | "SPRING_HYGIENE" | "OTHER";

export interface RawFinding {
  scanner: string;
  severity: Severity;
  category: Category;
  ruleId: string;
  title: string;
  description?: string;
  file?: string;
  line?: number;
  fingerprint: string;
}

export interface ScannerResult {
  scanner: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  findings: RawFinding[];
}

function fingerprint(parts: Array<string | number | undefined>): string {
  return createHash("sha256").update(parts.filter(Boolean).join("\x1f")).digest("hex");
}

function mapTrivySeverity(s: string): Severity {
  const u = (s || "").toUpperCase();
  if (u === "CRITICAL") return "CRIT";
  if (u === "HIGH") return "HIGH";
  if (u === "MEDIUM") return "MED";
  if (u === "LOW") return "LOW";
  return "INFO";
}

function runProcess(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{
  code: number; stdout: string; stderr: string; killed: boolean;
}> {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", killed = false;
    const child = spawn(cmd, args, { cwd: opts.cwd });
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? SCAN_TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + "\n" + err.message, killed });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, killed });
    });
  });
}

export async function runTrivy(repoDir: string, repoFullName: string): Promise<ScannerResult> {
  const t0 = Date.now();
  const outFile = path.join(os.tmpdir(), `trivy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  try {
    const r = await runProcess(
      TRIVY_BIN,
      [
        "fs",
        "--quiet",
        "--no-progress",
        "--offline-scan",
        "--scanners", "vuln,secret,misconfig",
        "--format", "json",
        "--severity", "CRITICAL,HIGH,MEDIUM,LOW",
        "--output", outFile,
        repoDir,
      ],
      { timeoutMs: SCAN_TIMEOUT_MS },
    );
    if (r.killed) {
      return { scanner: "trivy", ok: false, durationMs: Date.now() - t0, error: "timeout", findings: [] };
    }
    // Trivy exits 0 even with findings. Non-zero = bad input or DB issue.
    if (r.code !== 0 && r.code !== 1) {
      return { scanner: "trivy", ok: false, durationMs: Date.now() - t0, error: r.stderr.slice(0, 500) || `exit ${r.code}`, findings: [] };
    }
    const raw = await fs.readFile(outFile, "utf8").catch(() => "{}");
    await fs.unlink(outFile).catch(() => {});
    const parsed = JSON.parse(raw);
    const findings: RawFinding[] = [];
    for (const result of parsed.Results ?? []) {
      const target = result.Target ?? "?";
      for (const v of result.Vulnerabilities ?? []) {
        const fp = fingerprint([repoFullName, "trivy", v.VulnerabilityID, v.PkgName, v.InstalledVersion, target]);
        findings.push({
          scanner: "trivy",
          severity: mapTrivySeverity(v.Severity),
          category: "CVE",
          ruleId: v.VulnerabilityID ?? "UNKNOWN",
          title: `${v.VulnerabilityID}: ${v.PkgName}${v.InstalledVersion ? ` ${v.InstalledVersion}` : ""}`,
          description: v.Title || v.Description,
          file: target,
          fingerprint: fp,
        });
      }
      for (const m of result.Misconfigurations ?? []) {
        const fp = fingerprint([repoFullName, "trivy-iac", m.ID, target, m.StartLine]);
        findings.push({
          scanner: "trivy",
          severity: mapTrivySeverity(m.Severity),
          category: "IAC",
          ruleId: m.ID ?? "MISC",
          title: m.Title ?? "Misconfiguration",
          description: m.Description,
          file: target,
          line: m.StartLine ?? undefined,
          fingerprint: fp,
        });
      }
      for (const s of result.Secrets ?? []) {
        const fp = fingerprint([repoFullName, "trivy-secret", s.RuleID, target, s.StartLine]);
        findings.push({
          scanner: "trivy",
          severity: mapTrivySeverity(s.Severity),
          category: "SECRET",
          ruleId: s.RuleID ?? "SECRET",
          title: s.Title || `Secret: ${s.RuleID}`,
          description: s.Match,
          file: target,
          line: s.StartLine ?? undefined,
          fingerprint: fp,
        });
      }
    }
    return { scanner: "trivy", ok: true, durationMs: Date.now() - t0, findings };
  } catch (err) {
    await fs.unlink(outFile).catch(() => {});
    return {
      scanner: "trivy",
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : "unknown",
      findings: [],
    };
  }
}

export async function runGitleaks(repoDir: string, repoFullName: string): Promise<ScannerResult> {
  const t0 = Date.now();
  const outFile = path.join(os.tmpdir(), `gitleaks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  try {
    const r = await runProcess(
      GITLEAKS_BIN,
      ["dir", repoDir, "-r", outFile, "--no-banner", "--redact"],
      { timeoutMs: SCAN_TIMEOUT_MS },
    );
    if (r.killed) {
      return { scanner: "gitleaks", ok: false, durationMs: Date.now() - t0, error: "timeout", findings: [] };
    }
    // Gitleaks exits 0 = no leaks, 1 = leaks found, other = error.
    if (r.code !== 0 && r.code !== 1) {
      return { scanner: "gitleaks", ok: false, durationMs: Date.now() - t0, error: r.stderr.slice(0, 500) || `exit ${r.code}`, findings: [] };
    }
    const raw = await fs.readFile(outFile, "utf8").catch(() => "[]");
    await fs.unlink(outFile).catch(() => {});
    const leaks = JSON.parse(raw);
    const findings: RawFinding[] = (Array.isArray(leaks) ? leaks : []).map((l: Record<string, unknown>) => {
      const file = (l.File as string) ?? "";
      const line = (l.StartLine as number) ?? undefined;
      const rule = (l.RuleID as string) ?? "secret";
      const fp = fingerprint([repoFullName, "gitleaks", rule, file, line]);
      return {
        scanner: "gitleaks",
        severity: "HIGH" as Severity,
        category: "SECRET" as Category,
        ruleId: rule,
        title: (l.Description as string) || `Secret: ${rule}`,
        description: ((l.Match as string) ?? "").slice(0, 200),
        file: file || undefined,
        line,
        fingerprint: fp,
      };
    });
    return { scanner: "gitleaks", ok: true, durationMs: Date.now() - t0, findings };
  } catch (err) {
    await fs.unlink(outFile).catch(() => {});
    return {
      scanner: "gitleaks",
      ok: false,
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : "unknown",
      findings: [],
    };
  }
}

export async function runAll(repoDir: string, repoFullName: string): Promise<ScannerResult[]> {
  return Promise.all([runTrivy(repoDir, repoFullName), runGitleaks(repoDir, repoFullName)]);
}
