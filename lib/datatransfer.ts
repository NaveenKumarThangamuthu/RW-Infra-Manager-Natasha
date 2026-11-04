/**
 * Data-transfer cost classification.
 *
 * Cost Explorer does NOT expose individual IP addresses for data transfer — it
 * categorizes traffic by USAGE_TYPE. We map each usage type to a "public IP /
 * internet" bucket or a "private IP / intra-AWS" bucket as a faithful proxy for
 * the public-vs-private-IP distinction the AWS bill itself is based on.
 */
export type DTCategory = "Public IP / Internet" | "Private IP / Intra-AWS" | "Other transfer";

export const DT_CATEGORIES: DTCategory[] = [
  "Public IP / Internet",
  "Private IP / Intra-AWS",
  "Other transfer",
];

/** True if this usage type represents data transfer (or a public-IP address charge). */
export function isDataTransferUsageType(usageType: string): boolean {
  const u = usageType.toLowerCase();
  return (
    u.includes("bytes") ||
    u.includes("datatransfer") ||
    u.includes("data-transfer") ||
    u.includes("publicipv4") ||
    u.includes("elasticip")
  );
}

export function classifyUsageType(usageType: string): DTCategory {
  const u = usageType.toLowerCase();

  // Public IPv4 address hourly charges + Elastic IP — billed because a PUBLIC IP is used.
  if (u.includes("publicipv4") || u.includes("elasticip") || u.includes("idleaddress")) {
    return "Public IP / Internet";
  }

  // Private / intra-AWS paths first (these often also contain "-out-bytes").
  // Regional = cross-AZ over private IP; "*-AWS-In/Out-Bytes" = inter-region AWS backbone.
  if (
    u.includes("regional") ||
    u.includes("aws-in-bytes") ||
    u.includes("aws-out-bytes") ||
    u.includes("vpcpeering") ||
    u.includes("privatelink") ||
    u.includes("natgateway")
  ) {
    return "Private IP / Intra-AWS";
  }

  // Internet egress / ingress over public IPs, and CloudFront.
  if (
    u.includes("datatransfer-out-bytes") ||
    u.includes("datatransfer-in-bytes") ||
    u.includes("-out-bytes") ||
    u.includes("-in-bytes") ||
    u.includes("cloudfront")
  ) {
    return "Public IP / Internet";
  }

  return "Other transfer";
}
