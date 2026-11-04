/**
 * DB-backed replacement for the spreadsheet allocation model. Builds an
 * IP/resource -> category map from the `server_tag` table (managed in /tags).
 */
import { prisma } from "./db";

export type AllocCategory = "2.0" | "3.0" | "Infra" | "Dev" | "Shared" | "Not using" | "Other";

export const ALLOC_CATEGORIES: AllocCategory[] = [
  "2.0",
  "3.0",
  "Infra",
  "Dev",
  "Shared",
  "Not using",
  "Other",
];

export interface AllocationModel {
  ipToCategory: Map<string, AllocCategory>;
  serverCount: number;
}

function normalize(raw: string): AllocCategory {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "2" || v === "2.0") return "2.0";
  if (v === "3" || v === "3.0") return "3.0";
  if (v.includes("2.0") && v.includes("3.0")) return "Shared"; // e.g. "2.0 & 3.0"
  if (v === "infra") return "Infra";
  if (v === "dev") return "Dev";
  if (v === "not using") return "Not using";
  if (v === "shared" || v === "common") return "Shared";
  return "Other";
}

/** Load the IP/resource -> category map from the database. */
export async function loadAllocationFromDb(): Promise<AllocationModel> {
  const tags = await prisma.serverTag.findMany();
  const ipToCategory = new Map<string, AllocCategory>();

  for (const t of tags) {
    const cat = normalize(t.category);
    const existing = ipToCategory.get(t.matchKey);
    // If the same key is tagged with conflicting categories, mark it Shared.
    if (existing && existing !== cat) {
      ipToCategory.set(t.matchKey, "Shared");
    } else {
      ipToCategory.set(t.matchKey, cat);
    }
  }

  return { ipToCategory, serverCount: tags.length };
}

/**
 * Accumulated EC2 cost per instance over the last `days`, summed from the
 * resource_daily_cost table. Lets per-instance cost exceed AWS's 14-day limit
 * (history grows as the twice-daily refresh stores more days).
 * Returns a map resourceId -> total cost, plus the earliest date present.
 */
export async function ec2DailyCostByResource(
  days: number,
): Promise<{ byResource: Map<string, number>; since: string; rowCount: number }> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = await prisma.resourceDailyCost.findMany({
    where: { service: "EC2", date: { gte: since } },
    select: { resourceId: true, amount: true },
  });
  const byResource = new Map<string, number>();
  for (const r of rows) {
    byResource.set(r.resourceId, (byResource.get(r.resourceId) ?? 0) + Number(r.amount));
  }
  return { byResource, since, rowCount: rows.length };
}
