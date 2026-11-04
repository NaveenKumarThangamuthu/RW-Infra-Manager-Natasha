/**
 * CloudWatch metric reads for Lambda — READ ONLY (GetMetricData).
 * Cost Explorer gives spend; CloudWatch gives the operational usage
 * (invocations, duration, errors) that customers actually care about.
 *
 * Requires the `cloudwatch:GetMetricData` IAM permission. If it's missing the
 * helper fails soft (returns an empty map) so the cost view still works.
 */
import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from "@aws-sdk/client-cloudwatch";

export interface LambdaMetric {
  invocations: number;
  errors: number;
  durationAvgMs: number;
  durationSumMs: number;
}

export interface LambdaRef {
  arn: string;
  region: string;
  name: string;
}

const cwClients: Record<string, CloudWatchClient> = {};
function cw(region: string): CloudWatchClient {
  if (!cwClients[region]) cwClients[region] = new CloudWatchClient({ region });
  return cwClients[region];
}

/** Parse region + function name out of a Lambda resource ARN. */
export function parseLambdaArn(arn: string): LambdaRef | null {
  // arn:aws:lambda:<region>:<acct>:function:<name>[:<version>]
  const m = /^arn:aws:lambda:([^:]+):[^:]+:function:([^:]+)/.exec(arn);
  if (!m) return null;
  return { arn, region: m[1], name: m[2] };
}

const SAFE_ID = (i: number) => `m${i}`;

/**
 * Fetch invocations (Sum), errors (Sum) and duration (Average + Sum) for each
 * function over the given range. Batches by region (<=100 functions / call =
 * 300 metric queries, under the 500 limit) and paginates.
 */
export async function getLambdaMetrics(
  funcs: LambdaRef[],
  range: { Start: string; End: string },
): Promise<Map<string, LambdaMetric>> {
  const out = new Map<string, LambdaMetric>();
  const startTime = new Date(`${range.Start}T00:00:00Z`);
  const endTime = new Date(`${range.End}T00:00:00Z`);
  const period = 86400; // daily points, summed/averaged below

  const byRegion = new Map<string, LambdaRef[]>();
  for (const f of funcs) {
    const list = byRegion.get(f.region) ?? [];
    list.push(f);
    byRegion.set(f.region, list);
  }

  await Promise.all(
    [...byRegion.entries()].map(async ([region, list]) => {
      // chunk to keep each request <= 300 queries (3 per function)
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const idToFn = new Map<string, { ref: LambdaRef; kind: string }>();
        const queries: MetricDataQuery[] = [];

        chunk.forEach((ref, idx) => {
          const base = i + idx;
          const dims = [{ Name: "FunctionName", Value: ref.name }];
          const add = (suffix: string, metricName: string, stat: string) => {
            const id = `${SAFE_ID(base)}_${suffix}`;
            idToFn.set(id, { ref, kind: suffix });
            queries.push({
              Id: id,
              MetricStat: {
                Metric: { Namespace: "AWS/Lambda", MetricName: metricName, Dimensions: dims },
                Period: period,
                Stat: stat,
              },
              ReturnData: true,
            });
          };
          add("inv", "Invocations", "Sum");
          add("err", "Errors", "Sum");
          add("durSum", "Duration", "Sum");
          add("durAvg", "Duration", "Average");
        });

        try {
          let nextToken: string | undefined;
          const acc = new Map<string, number[]>();
          do {
            const res = await cw(region).send(
              new GetMetricDataCommand({
                MetricDataQueries: queries,
                StartTime: startTime,
                EndTime: endTime,
                NextToken: nextToken,
              }),
            );
            for (const r of res.MetricDataResults ?? []) {
              if (!r.Id) continue;
              const vals = acc.get(r.Id) ?? [];
              vals.push(...(r.Values ?? []));
              acc.set(r.Id, vals);
            }
            nextToken = res.NextToken;
          } while (nextToken);

          for (const [id, meta] of idToFn.entries()) {
            const vals = acc.get(id) ?? [];
            const sum = vals.reduce((s, v) => s + v, 0);
            const avg = vals.length ? sum / vals.length : 0;
            const cur = out.get(meta.ref.arn) ?? { invocations: 0, errors: 0, durationAvgMs: 0, durationSumMs: 0 };
            if (meta.kind === "inv") cur.invocations = sum;
            else if (meta.kind === "err") cur.errors = sum;
            else if (meta.kind === "durSum") cur.durationSumMs = sum;
            else if (meta.kind === "durAvg") cur.durationAvgMs = avg;
            out.set(meta.ref.arn, cur);
          }
        } catch {
          // Region disabled or GetMetricData denied — skip; cost view still works.
        }
      }
    }),
  );

  return out;
}
