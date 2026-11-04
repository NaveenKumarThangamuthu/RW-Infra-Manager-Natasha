/**
 * Lambda function inventory — READ ONLY (ListFunctions across regions).
 * Used to show per-function usage (invocations/duration/errors) regardless of
 * whether resource-level Cost Explorer data itemizes Lambda.
 *
 * Requires `lambda:ListFunctions`. Fails soft per region.
 */
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { listRegions } from "./ec2";

export interface LambdaFunctionInfo {
  arn: string;
  region: string;
  name: string;
  runtime: string;
  memoryMb: number;
}

const clients: Record<string, LambdaClient> = {};
function client(region: string): LambdaClient {
  if (!clients[region]) clients[region] = new LambdaClient({ region });
  return clients[region];
}

/** List every Lambda function across all enabled regions. */
export async function listAllFunctions(): Promise<LambdaFunctionInfo[]> {
  const regions = await listRegions();
  const out: LambdaFunctionInfo[] = [];

  await Promise.all(
    regions.map(async (region) => {
      try {
        let marker: string | undefined;
        do {
          const res = await client(region).send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
          for (const fn of res.Functions ?? []) {
            if (!fn.FunctionArn || !fn.FunctionName) continue;
            out.push({
              arn: fn.FunctionArn,
              region,
              name: fn.FunctionName,
              runtime: fn.Runtime ?? "-",
              memoryMb: fn.MemorySize ?? 0,
            });
          }
          marker = res.NextMarker;
        } while (marker);
      } catch {
        // region disabled / unauthorized — skip
      }
    }),
  );

  return out;
}
