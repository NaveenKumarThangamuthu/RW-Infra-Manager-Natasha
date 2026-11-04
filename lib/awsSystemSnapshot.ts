/**
 * AWS-side system snapshot for a single EC2 instance.
 * Combines four read-only sources into one payload for the Errors tab:
 *   1. ssm:DescribeInstanceInformation → agent state
 *   2. ssm:GetInventory (AWS:InstanceInformation + AWS:Application) → OS + package count
 *   3. ec2:GetConsoleOutput → last 30 lines when supported
 *   4. cloudtrail:LookupEvents → API calls touching this instance in the last 1h
 *   5. logs:DescribeLogGroups + logs:FilterLogEvents → any CW log groups that reference the instance id
 *
 * Any single failure degrades gracefully — the payload includes per-block status flags so
 * the UI can render "unsupported" / "denied" / "no data" messages instead of a blank card.
 */
import { EC2Client, GetConsoleOutputCommand } from "@aws-sdk/client-ec2";
import {
  SSMClient,
  DescribeInstanceInformationCommand,
  GetInventoryCommand,
} from "@aws-sdk/client-ssm";
import {
  CloudTrailClient,
  LookupEventsCommand,
} from "@aws-sdk/client-cloudtrail";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

export interface AwsSystemSnapshot {
  instanceId: string;
  region: string;
  fetchedAt: string;
  ssm: {
    status: "online" | "connection-lost" | "not-managed" | "unknown";
    agentVersion: string | null;
    platformName: string | null;
    platformVersion: string | null;
    computerName: string | null;
    lastPingAt: string | null;
    ipAddress: string | null;
  };
  inventory: {
    packagesCount: number | null;
    packagesTopByName?: Array<{ name: string; version: string }>;
    error: string | null;
  };
  console: {
    supported: boolean;
    lines: string[];
    capturedAt: string | null;
    error: string | null;
  };
  cloudTrail: {
    events: Array<{
      eventTime: string;
      eventName: string;
      username: string | null;
      sourceIp: string | null;
    }>;
    error: string | null;
  };
  logGroups: {
    matched: Array<{ name: string; lastEventAt: string | null; sample: string[] }>;
    error: string | null;
  };
}

function decodeConsole(b64: string | undefined): string[] {
  if (!b64) return [];
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.toString("utf8").split("\n").filter((l) => l.trim()).slice(-30);
  } catch {
    return [];
  }
}

async function pullSsmInformation(client: SSMClient, instanceId: string): Promise<AwsSystemSnapshot["ssm"]> {
  const empty: AwsSystemSnapshot["ssm"] = {
    status: "not-managed",
    agentVersion: null,
    platformName: null,
    platformVersion: null,
    computerName: null,
    lastPingAt: null,
    ipAddress: null,
  };
  try {
    const r = await client.send(
      new DescribeInstanceInformationCommand({
        Filters: [{ Key: "InstanceIds", Values: [instanceId] }],
        MaxResults: 5,
      })
    );
    const it = r.InstanceInformationList?.[0];
    if (!it) return empty;
    const status =
      it.PingStatus === "Online"
        ? "online"
        : it.PingStatus === "ConnectionLost"
          ? "connection-lost"
          : "unknown";
    return {
      status,
      agentVersion: it.AgentVersion ?? null,
      platformName: it.PlatformName ?? null,
      platformVersion: it.PlatformVersion ?? null,
      computerName: it.ComputerName ?? null,
      lastPingAt: it.LastPingDateTime ? new Date(it.LastPingDateTime).toISOString() : null,
      ipAddress: it.IPAddress ?? null,
    };
  } catch {
    return empty;
  }
}

async function pullSsmInventory(
  client: SSMClient,
  instanceId: string
): Promise<AwsSystemSnapshot["inventory"]> {
  try {
    // Application inventory
    const app = await client.send(
      new GetInventoryCommand({
        Filters: [{ Key: "AWS:Application.InstanceId", Values: [instanceId], Type: "Equal" }],
        MaxResults: 500,
      })
    );
    const appContent =
      app.Entities?.[0]?.Data?.["AWS:Application"]?.Content ?? [];
    return {
      packagesCount: appContent.length || null,
      packagesTopByName: appContent
        .slice(0, 6)
        .map((a) => ({ name: a.Name ?? "?", version: a.Version ?? "?" })),
      error: null,
    };
  } catch (e) {
    return { packagesCount: null, error: e instanceof Error ? e.message : "inventory failed" };
  }
}

async function pullConsole(
  client: EC2Client,
  instanceId: string
): Promise<AwsSystemSnapshot["console"]> {
  try {
    const r = await client.send(
      new GetConsoleOutputCommand({ InstanceId: instanceId, Latest: true })
    );
    const lines = decodeConsole(r.Output);
    return {
      supported: true,
      lines,
      capturedAt: r.Timestamp ? new Date(r.Timestamp).toISOString() : null,
      error: lines.length === 0 ? "post-boot silent (Nitro instances stop writing to console after boot)" : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unsupported = /UnsupportedOperation/i.test(msg);
    return {
      supported: !unsupported,
      lines: [],
      capturedAt: null,
      error: unsupported ? "instance type does not support console-output API" : msg.slice(0, 200),
    };
  }
}

async function pullCloudTrail(
  client: CloudTrailClient,
  instanceId: string
): Promise<AwsSystemSnapshot["cloudTrail"]> {
  try {
    const now = new Date();
    const ago = new Date(now.getTime() - 60 * 60 * 1000);
    const r = await client.send(
      new LookupEventsCommand({
        LookupAttributes: [
          { AttributeKey: "ResourceName", AttributeValue: instanceId },
        ],
        StartTime: ago,
        EndTime: now,
        MaxResults: 20,
      })
    );
    const events = (r.Events ?? []).map((e) => {
      let sourceIp: string | null = null;
      let username: string | null = e.Username ?? null;
      if (e.CloudTrailEvent) {
        try {
          const parsed = JSON.parse(e.CloudTrailEvent) as {
            sourceIPAddress?: string;
            userIdentity?: { userName?: string; arn?: string; type?: string };
          };
          sourceIp = parsed.sourceIPAddress ?? null;
          username = username ?? parsed.userIdentity?.userName ?? parsed.userIdentity?.arn ?? null;
        } catch {
          /* ignore */
        }
      }
      return {
        eventTime: e.EventTime ? new Date(e.EventTime).toISOString() : "",
        eventName: e.EventName ?? "?",
        username,
        sourceIp,
      };
    });
    return { events, error: null };
  } catch (e) {
    return { events: [], error: e instanceof Error ? e.message : "cloudtrail lookup failed" };
  }
}

async function pullMatchingLogGroups(
  client: CloudWatchLogsClient,
  instanceId: string,
  privateIp: string | null,
  publicIp: string | null
): Promise<AwsSystemSnapshot["logGroups"]> {
  try {
    // Cheap: list groups whose logGroupNamePrefix hints at EC2 / system logs.
    const results: AwsSystemSnapshot["logGroups"]["matched"] = [];
    const seenNames = new Set<string>();
    for (const prefix of ["/aws/ec2", "/ec2", "/var/log", "/system", "/host"]) {
      const g = await client.send(
        new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit: 20 })
      );
      for (const lg of g.logGroups ?? []) {
        if (!lg.logGroupName || seenNames.has(lg.logGroupName)) continue;
        seenNames.add(lg.logGroupName);
        // Cheap probe: filter by instance id or private/public ip in the message
        const q = [instanceId, privateIp, publicIp].filter(Boolean).map((s) => `"${s}"`).join(" ");
        if (!q) continue;
        try {
          const f = await client.send(
            new FilterLogEventsCommand({
              logGroupName: lg.logGroupName,
              filterPattern: q,
              limit: 5,
              startTime: Date.now() - 60 * 60 * 1000,
            })
          );
          const evs = f.events ?? [];
          if (evs.length === 0) continue;
          results.push({
            name: lg.logGroupName,
            lastEventAt: evs[0].timestamp ? new Date(evs[0].timestamp).toISOString() : null,
            sample: evs.slice(0, 3).map((e) => (e.message ?? "").slice(0, 200)),
          });
        } catch {
          /* skip this group */
        }
      }
    }
    return { matched: results, error: null };
  } catch (e) {
    return { matched: [], error: e instanceof Error ? e.message : "log-groups lookup failed" };
  }
}

export async function buildSystemSnapshot(
  instanceId: string,
  region: string,
  privateIp: string | null,
  publicIp: string | null
): Promise<AwsSystemSnapshot> {
  const ec2 = new EC2Client({ region });
  const ssm = new SSMClient({ region });
  const ct = new CloudTrailClient({ region });
  const cwl = new CloudWatchLogsClient({ region });

  const [ssmInfo, invInfo, consoleInfo, ctInfo, lgInfo] = await Promise.all([
    pullSsmInformation(ssm, instanceId),
    pullSsmInventory(ssm, instanceId),
    pullConsole(ec2, instanceId),
    pullCloudTrail(ct, instanceId),
    pullMatchingLogGroups(cwl, instanceId, privateIp, publicIp),
  ]);

  return {
    instanceId,
    region,
    fetchedAt: new Date().toISOString(),
    ssm: ssmInfo,
    inventory: invInfo,
    console: consoleInfo,
    cloudTrail: ctInfo,
    logGroups: lgInfo,
  };
}
