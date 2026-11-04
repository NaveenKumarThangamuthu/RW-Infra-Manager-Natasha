import { NextResponse } from "next/server";
import { resourceCostForService, SERVICE } from "@/lib/costExplorer";
import { lastNDaysRange } from "@/lib/dates";
import { cached, DEFAULT_TTL } from "@/lib/cache";
import { listAllFunctions } from "@/lib/lambda";
import { getLambdaMetrics, type LambdaRef } from "@/lib/cloudwatch";

export const dynamic = "force-dynamic";

/**
 * Lambda usage per function — invocations, errors, duration and computed
 * GB-seconds from CloudWatch — plus total cost and a usage-type cost breakdown
 * from Cost Explorer. Functions are listed directly (ListFunctions) so usage is
 * shown even when resource-level cost data doesn't itemize Lambda.
 */
export async function GET() {
  try {
    const payload = await cached("lambda", DEFAULT_TTL, async () => {
      const range = lastNDaysRange(14);

      const [byUsage, fns] = await Promise.all([
        resourceCostForService(SERVICE.LAMBDA, range, "USAGE_TYPE"),
        listAllFunctions(),
      ]);

      const refs: LambdaRef[] = fns.map((f) => ({ arn: f.arn, region: f.region, name: f.name }));
      const metrics = await getLambdaMetrics(refs, range);

      const functions = fns
        .map((f) => {
          const m = metrics.get(f.arn);
          const durationSumMs = m?.durationSumMs ?? 0;
          // GB-seconds = (duration seconds) * (memory GB)
          const gbSeconds = (durationSumMs / 1000) * (f.memoryMb / 1024);
          return {
            arn: f.arn,
            name: f.name,
            region: f.region,
            runtime: f.runtime,
            memoryMb: f.memoryMb,
            invocations: m?.invocations ?? 0,
            errors: m?.errors ?? 0,
            durationAvgMs: m?.durationAvgMs ?? 0,
            gbSeconds,
          };
        })
        .sort((a, b) => b.invocations - a.invocations);

      // Cost by usage type (aggregate; Lambda often isn't itemized per function).
      const provisioning = byUsage.map((c) => {
        const parts = c.key.split(" / ");
        const usageType = parts[parts.length - 1] ?? "";
        let category = "Other";
        const u = usageType.toLowerCase();
        if (u.includes("provisioned")) category = "Provisioned Concurrency";
        else if (u.includes("request")) category = "Requests";
        else if (u.includes("gb-second") || u.includes("lambda-gb")) category = "Duration (GB-s)";
        else if (u.includes("edge")) category = "Lambda@Edge";
        return { resourceAndUsage: c.key, usageType, category, cost: c.amount, unit: c.unit };
      });

      const totalCost = provisioning.reduce((s, p) => s + p.cost, 0);
      const totalInvocations = functions.reduce((s, f) => s + f.invocations, 0);
      const totalErrors = functions.reduce((s, f) => s + f.errors, 0);
      const metricsAvailable = metrics.size > 0;

      return {
        range,
        total: totalCost,
        totalInvocations,
        totalErrors,
        metricsAvailable,
        functionCount: functions.length,
        functions,
        provisioning,
      };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lambda cost request failed" },
      { status: 500 },
    );
  }
}
