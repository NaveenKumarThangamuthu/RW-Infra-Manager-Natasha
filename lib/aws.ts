/**
 * Centralized AWS SDK clients.
 *
 * READ-ONLY POLICY: This module and everything that imports it must only ever
 * issue Get / Describe / List calls. No create, update, delete, put, modify, or terminate.
 *
 * Credentials are resolved by the AWS SDK default provider chain (env vars,
 * shared config/credentials file, SSO cache, IAM role). Nothing is hardcoded.
 * These clients are constructed on the server only (Next.js route handlers).
 */
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";
import { EC2Client } from "@aws-sdk/client-ec2";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { RDSClient } from "@aws-sdk/client-rds";

// Cost Explorer is global; its single endpoint lives in us-east-1.
export const CE_REGION = "us-east-1";

let ceClient: CostExplorerClient | null = null;

export function getCostExplorerClient(): CostExplorerClient {
  if (!ceClient) {
    ceClient = new CostExplorerClient({ region: CE_REGION });
  }
  return ceClient;
}

// EC2 is regional — we build a client per region on demand.
const ec2Clients: Record<string, EC2Client> = {};

export function getEc2Client(region: string): EC2Client {
  if (!ec2Clients[region]) {
    ec2Clients[region] = new EC2Client({ region });
  }
  return ec2Clients[region];
}

// RDS is regional — one client per region for DescribeDBInstances/Clusters.
const rdsClients: Record<string, RDSClient> = {};

export function getRdsClient(region: string): RDSClient {
  if (!rdsClients[region]) {
    rdsClients[region] = new RDSClient({ region });
  }
  return rdsClients[region];
}

// CloudWatch is regional — one client per region for DescribeAlarms.
const cwClients: Record<string, CloudWatchClient> = {};

export function getCloudWatchClient(region: string): CloudWatchClient {
  if (!cwClients[region]) {
    cwClients[region] = new CloudWatchClient({ region });
  }
  return cwClients[region];
}
