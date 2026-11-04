/**
 * Instance type specs + rough on-demand monthly prices (us-east-1, Linux, 730h/mo).
 * Prices are approximate and only used for recommendation cost deltas — not billing.
 * Update if AWS retires/repriclines a family.
 */
import { DescribeInstanceTypesCommand, type _InstanceType } from "@aws-sdk/client-ec2";
import { getEc2Client } from "./aws";

export interface InstanceSpec {
  type: string;
  vCpus: number;
  memMiB: number;
  burstable: boolean;
  family: string;
  size: string;
  priceMonthUsd: number | null;
}

// Rough on-demand $/mo (730h) for us-east-1, Linux. Approximate as of 2024-2025.
const PRICE_MONTH: Record<string, number> = {
  // t2
  "t2.nano": 4.18, "t2.micro": 8.47, "t2.small": 16.79, "t2.medium": 33.58,
  "t2.large": 67.16, "t2.xlarge": 134.32, "t2.2xlarge": 268.64,
  // t3
  "t3.nano": 3.80, "t3.micro": 7.59, "t3.small": 15.19, "t3.medium": 30.37,
  "t3.large": 60.74, "t3.xlarge": 121.47, "t3.2xlarge": 242.94,
  // t3a
  "t3a.nano": 3.43, "t3a.micro": 6.86, "t3a.small": 13.72, "t3a.medium": 27.45,
  "t3a.large": 54.90, "t3a.xlarge": 109.79, "t3a.2xlarge": 219.58,
  // m5
  "m5.large": 70.08, "m5.xlarge": 140.16, "m5.2xlarge": 280.32, "m5.4xlarge": 560.64,
  "m5.8xlarge": 1121.28, "m5.12xlarge": 1681.92, "m5.16xlarge": 2242.56, "m5.24xlarge": 3363.84,
  // m6i
  "m6i.large": 70.08, "m6i.xlarge": 140.16, "m6i.2xlarge": 280.32, "m6i.4xlarge": 560.64,
  // c5
  "c5.large": 62.05, "c5.xlarge": 124.10, "c5.2xlarge": 248.20, "c5.4xlarge": 496.40,
  "c5.9xlarge": 1116.90, "c5.12xlarge": 1489.20, "c5.18xlarge": 2233.80, "c5.24xlarge": 2978.40,
  // c6i
  "c6i.large": 62.05, "c6i.xlarge": 124.10, "c6i.2xlarge": 248.20, "c6i.4xlarge": 496.40,
  // r5
  "r5.large": 92.00, "r5.xlarge": 184.00, "r5.2xlarge": 368.00, "r5.4xlarge": 736.00,
  "r5.8xlarge": 1472.00, "r5.12xlarge": 2208.00, "r5.16xlarge": 2944.00, "r5.24xlarge": 4416.00,
};

// Size order within a family
const SIZE_ORDER = [
  "nano", "micro", "small", "medium", "large",
  "xlarge", "2xlarge", "3xlarge", "4xlarge", "6xlarge", "8xlarge",
  "9xlarge", "10xlarge", "12xlarge", "16xlarge", "18xlarge", "24xlarge", "32xlarge",
];

export function parseType(type: string): { family: string; size: string } {
  const [family, size] = type.split(".");
  return { family: family ?? "", size: size ?? "" };
}

export function nextSmaller(type: string): string | null {
  const { family, size } = parseType(type);
  const idx = SIZE_ORDER.indexOf(size);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = `${family}.${SIZE_ORDER[i]}`;
    if (candidate in PRICE_MONTH) return candidate;
  }
  return null;
}

export function nextLarger(type: string): string | null {
  const { family, size } = parseType(type);
  const idx = SIZE_ORDER.indexOf(size);
  if (idx < 0 || idx >= SIZE_ORDER.length - 1) return null;
  for (let i = idx + 1; i < SIZE_ORDER.length; i++) {
    const candidate = `${family}.${SIZE_ORDER[i]}`;
    if (candidate in PRICE_MONTH) return candidate;
  }
  return null;
}

export function priceMonth(type: string): number | null {
  return PRICE_MONTH[type] ?? null;
}

// Map "legacy family" → ordered list of modern equivalents (cheaper AND/or newer).
// Keeping the same size is safe; different-family same-size instances usually have
// similar vCPU/mem, so recommending them is a small blast radius.
const MODERN_EQUIVALENTS: Record<string, string[]> = {
  t2: ["t3", "t3a"],       // t3 is Nitro/burstable, t3a is same but on AMD (cheaper ~10%)
  m5: ["m6i", "m5a"],      // m6i is Ice Lake, faster + same price. m5a is AMD (cheaper)
  c5: ["c6i"],             // c6i replaces c5
  r5: ["r6i", "r5a"],      // r6i is newer memory-optimized
};

/** Returns modern-generation same-size equivalents of `type`, if any (excluding self). */
export function modernEquivalents(type: string): string[] {
  const { family, size } = parseType(type);
  const targets = MODERN_EQUIVALENTS[family];
  if (!targets) return [];
  const out: string[] = [];
  for (const newFam of targets) {
    const candidate = `${newFam}.${size}`;
    if (candidate in PRICE_MONTH && candidate !== type) out.push(candidate);
  }
  return out;
}

/** Returns true if `type` is a legacy family for which modern replacements exist. */
export function isLegacyFamily(type: string): boolean {
  return modernEquivalents(type).length > 0;
}

const specCache = new Map<string, InstanceSpec>();

export async function getInstanceSpecs(
  types: string[],
  region: string = "us-east-1",
): Promise<Map<string, InstanceSpec>> {
  const toFetch = types.filter((t) => t && !specCache.has(t));
  if (toFetch.length) {
    try {
      const res = await getEc2Client(region).send(
        new DescribeInstanceTypesCommand({ InstanceTypes: toFetch as _InstanceType[] }),
      );
      for (const t of res.InstanceTypes ?? []) {
        if (!t.InstanceType) continue;
        const { family, size } = parseType(t.InstanceType);
        specCache.set(t.InstanceType, {
          type: t.InstanceType,
          vCpus: t.VCpuInfo?.DefaultVCpus ?? 0,
          memMiB: t.MemoryInfo?.SizeInMiB ?? 0,
          burstable: Boolean(t.BurstablePerformanceSupported),
          family, size,
          priceMonthUsd: PRICE_MONTH[t.InstanceType] ?? null,
        });
      }
    } catch {
      /* fall back to price table only */
    }
  }
  const out = new Map<string, InstanceSpec>();
  for (const t of types) {
    const cached = specCache.get(t);
    if (cached) out.set(t, cached);
    else if (t in PRICE_MONTH) {
      const { family, size } = parseType(t);
      out.set(t, { type: t, vCpus: 0, memMiB: 0, burstable: family.startsWith("t"), family, size, priceMonthUsd: PRICE_MONTH[t] });
    }
  }
  return out;
}
