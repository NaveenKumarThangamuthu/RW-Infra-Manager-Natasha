/**
 * CloudWatch alarms — READ-ONLY (DescribeAlarms).
 * Returns alarms in ALARM or INSUFFICIENT_DATA state across all regions.
 */
import { DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { getCloudWatchClient } from "./aws";
import { listRegions } from "./ec2";

export interface AlarmInfo {
  name: string;
  region: string;
  state: string;
  reason: string;
  metric: string;
  namespace: string;
  updatedAt: string | null;
}

export async function listOpenAlarms(): Promise<AlarmInfo[]> {
  const regions = await listRegions();
  const out: AlarmInfo[] = [];

  await Promise.all(
    regions.map(async (region) => {
      try {
        const client = getCloudWatchClient(region);
        let next: string | undefined;
        do {
          const res = await client.send(
            new DescribeAlarmsCommand({
              StateValue: undefined, // pull all, filter client-side
              NextToken: next,
              MaxRecords: 100,
            }),
          );
          for (const a of res.MetricAlarms ?? []) {
            if (a.StateValue === "OK") continue;
            out.push({
              name: a.AlarmName ?? "(unnamed)",
              region,
              state: a.StateValue ?? "-",
              reason: a.StateReason ?? "",
              metric: a.MetricName ?? "-",
              namespace: a.Namespace ?? "-",
              updatedAt: a.StateUpdatedTimestamp ? a.StateUpdatedTimestamp.toISOString() : null,
            });
          }
          next = res.NextToken;
        } while (next);
      } catch {
        /* region disabled / unauthorized */
      }
    }),
  );

  out.sort((a, b) => {
    if (a.state !== b.state) return a.state === "ALARM" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}
