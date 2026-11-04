/**
 * One-time bulk import of EC2 tags from a CSV export. Column D (4th column) is
 * the manual tag (2.0 / 3.0 / Infra / Dev / "2.0 & 3.0" / unknow / ...). Rows
 * are upserted into `server_tag` keyed by InstanceId (the same key the EC2
 * screen edits), so the allocation buckets pick them up immediately.
 *
 * CSV columns: Region, InstanceId, Name, <TAG>, State, InstanceType, AZ,
 *              PrivateIp, PublicIp, VpcId, LaunchTime
 *
 * Usage: CSV_PATH=/abs/path/to/file.csv npm run import:csv
 */
import * as fs from "fs";
import { prisma } from "../lib/db";

type Category = "2.0" | "3.0" | "Infra" | "Dev" | "Shared" | "Not using" | "Other";

function normalize(raw: string): Category {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "2" || v === "2.0") return "2.0";
  if (v === "3" || v === "3.0") return "3.0";
  if (v.includes("2.0") && v.includes("3.0")) return "Shared"; // "2.0 & 3.0"
  if (v === "infra") return "Infra";
  if (v === "dev") return "Dev";
  if (v === "not using") return "Not using";
  if (v === "shared" || v === "common") return "Shared";
  return "Other"; // includes "unknow", blank, anything else
}

async function main() {
  const path = process.env.CSV_PATH;
  if (!path) {
    console.error("CSV_PATH env var is required.");
    process.exit(1);
  }
  const text = fs.readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let imported = 0;
  const tally: Record<string, number> = {};

  for (let i = 1; i < lines.length; i++) {
    // Fields here are comma-free; a simple split is sufficient for this export.
    const cols = lines[i].split(",");
    if (cols.length < 9) continue;
    const region = cols[0]?.trim();
    const instanceId = cols[1]?.trim();
    const name = cols[2]?.trim();
    const rawTag = cols[3]?.trim();
    const instanceType = cols[5]?.trim();
    if (!instanceId || !instanceId.startsWith("i-")) continue;

    const category = normalize(rawTag);
    tally[category] = (tally[category] ?? 0) + 1;

    await prisma.serverTag.upsert({
      where: { matchKey: instanceId },
      update: { category, label: name || null, region: region || null, instanceType: instanceType || null },
      create: { matchKey: instanceId, category, label: name || null, region: region || null, instanceType: instanceType || null },
    });
    imported++;
  }

  console.log(`Imported/updated ${imported} EC2 tags.`);
  console.log("By category:", tally);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
