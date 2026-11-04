/**
 * AWS Lambda inventory + CloudWatch metrics for the **Ohio (us-east-2)
 * region only**. Used by /perf/spring to surface Lambdas alongside Spring
 * services with their CloudWatch invocation/error counts. CloudWatch Logs
 * events are pulled on-demand when a row is expanded.
 *
 * Permissions needed:
 *   lambda:ListFunctions     (region: us-east-2)
 *   cloudwatch:GetMetricData (region: us-east-2)
 *   logs:DescribeLogStreams  (region: us-east-2)
 *   logs:FilterLogEvents     (region: us-east-2)
 */
import { LambdaClient, ListFunctionsCommand, type FunctionConfiguration } from "@aws-sdk/client-lambda";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";

export const OHIO_REGION = "us-east-2";

const lambdaClient = new LambdaClient({ region: OHIO_REGION });
const cwClient = new CloudWatchClient({ region: OHIO_REGION });
const logsClient = new CloudWatchLogsClient({ region: OHIO_REGION });

export interface LambdaSummary {
  arn: string;
  name: string;
  runtime: string;
  memoryMb: number;
  lastModified: string | null;
  invocations24h: number;
  errors24h: number;
  errorRate: number;
}

interface MetricForName { name: string; invocations: number; errors: number }

async function fetchMetricsForFunctions(names: string[]): Promise<Map<string, MetricForName>> {
  // GetMetricData lets us batch up to 500 queries per call. Each function
  // contributes 2 metrics (Invocations + Errors). To stay safely under the
  // limit, chunk to 200 functions per call (400 queries).
  const out = new Map<string, MetricForName>();
  if (names.length === 0) return out;
  const CHUNK = 200;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 3_600_000);

  for (let off = 0; off < names.length; off += CHUNK) {
    const chunk = names.slice(off, off + CHUNK);
    const queries = chunk.flatMap((n, idx) => [
      {
        Id: `inv${off + idx}`,
        MetricStat: {
          Metric: {
            Namespace: "AWS/Lambda",
            MetricName: "Invocations",
            Dimensions: [{ Name: "FunctionName", Value: n }],
          },
          Period: 86_400,
          Stat: "Sum",
        },
        ReturnData: true,
      },
      {
        Id: `err${off + idx}`,
        MetricStat: {
          Metric: {
            Namespace: "AWS/Lambda",
            MetricName: "Errors",
            Dimensions: [{ Name: "FunctionName", Value: n }],
          },
          Period: 86_400,
          Stat: "Sum",
        },
        ReturnData: true,
      },
    ]);
    const res = await cwClient.send(new GetMetricDataCommand({
      MetricDataQueries: queries,
      StartTime: startTime,
      EndTime: endTime,
      ScanBy: "TimestampDescending",
    }));
    const byId = new Map<string, number>();
    for (const m of res.MetricDataResults ?? []) {
      if (!m.Id) continue;
      byId.set(m.Id, (m.Values ?? []).reduce((a, b) => a + b, 0));
    }
    chunk.forEach((n, idx) => {
      const inv = byId.get(`inv${off + idx}`) ?? 0;
      const err = byId.get(`err${off + idx}`) ?? 0;
      out.set(n, { name: n, invocations: inv, errors: err });
    });
  }
  return out;
}

export async function listOhioLambdas(): Promise<LambdaSummary[]> {
  const fns: FunctionConfiguration[] = [];
  let marker: string | undefined;
  do {
    const res = await lambdaClient.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 1000 }));
    fns.push(...(res.Functions ?? []));
    marker = res.NextMarker;
  } while (marker);

  const names = fns.map((f) => f.FunctionName ?? "").filter(Boolean);
  const metrics = await fetchMetricsForFunctions(names);

  return fns.map((f) => {
    const m = metrics.get(f.FunctionName ?? "");
    const inv = m?.invocations ?? 0;
    const err = m?.errors ?? 0;
    return {
      arn: f.FunctionArn ?? "",
      name: f.FunctionName ?? "",
      runtime: f.Runtime ?? "—",
      memoryMb: f.MemorySize ?? 0,
      lastModified: f.LastModified ?? null,
      invocations24h: inv,
      errors24h: err,
      errorRate: inv > 0 ? err / inv : 0,
    };
  }).sort((a, b) => b.invocations24h - a.invocations24h);
}

export interface LogEvent { at: string | null; stream: string | null; message: string }

/** Most recent CloudWatch Logs events for a Lambda function (last 1h). */
export async function fetchLambdaLogs(functionName: string, limit = 50, withinHours = 1): Promise<LogEvent[]> {
  const start = Date.now() - withinHours * 3_600_000;
  try {
    const res = await logsClient.send(new FilterLogEventsCommand({
      logGroupName: `/aws/lambda/${functionName}`,
      startTime: start,
      limit,
      // Most recent first — but FilterLogEvents returns ascending; we reverse below.
    }));
    const events = (res.events ?? []).map((e) => ({
      at: e.timestamp ? new Date(e.timestamp).toISOString() : null,
      stream: e.logStreamName ?? null,
      message: (e.message ?? "").slice(0, 4000),
    }));
    return events.reverse();
  } catch (err) {
    // Log group may not exist if the function has never been invoked.
    const code = (err as { name?: string }).name ?? "";
    if (code === "ResourceNotFoundException") return [];
    throw err;
  }
}
