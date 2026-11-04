# AWS Billing Dashboard (read-only)

A Next.js + React dashboard that shows your AWS spend with **per-resource depth**:

- **Overview** — month-to-date cost by service and by region.
- **EC2 (per server)** — cost per instance, joined with its **private/public IP**, name, type, state and region.
- **Lambda (per function)** — cost per function plus a breakdown of requests vs duration vs **provisioned concurrency**.
- **SNS (per topic)** — cost per topic plus usage-type (delivery channel) breakdown.
- **Regions** — region × service matrix.

> **Read-only by design.** Every AWS call is `Get*` / `Describe*` / `List*`. The app never creates, updates, or deletes anything. Credentials stay server-side (Next.js route handlers) and are never exposed to the browser.

## Prerequisites

1. **Cost Explorer enabled** for the account (Billing console → Cost Explorer → Enable).
2. **Resource-level data enabled** (Billing → Cost Explorer → Preferences → "Resource-level data"). This is required for the per-EC2 / per-Lambda / per-SNS views. AWS retains resource-level data for the **last 14 days only**, so those tabs always show a rolling 14-day window. There may be a small per-request charge for resource-level Cost Explorer queries.
3. You are **logged in** to AWS locally (`aws configure` or `aws sso login`). The app uses the AWS SDK default credential chain.
4. Node.js 18.17+.

## Setup

```bash
npm install
cp .env.local.example .env.local   # optional — only to pin AWS_PROFILE / AWS_REGION
npm run dev
```

Open http://localhost:3000.

To select a specific profile without editing files:

```bash
# PowerShell
$env:AWS_PROFILE="myprofile"; npm run dev
```

## Minimum read-only IAM policy

Attach this to the user/role the app runs as. It grants **only** reads:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BillingRead",
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "ce:GetCostAndUsageWithResources",
        "ce:GetDimensionValues",
        "ce:GetTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ResourceMetadataRead",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeRegions",
        "ec2:DescribeInstances",
        "sns:ListTopics"
      ],
      "Resource": "*"
    }
  ]
}
```

## How the depth works

| Tab | API | Notes |
|-----|-----|-------|
| Overview / Regions | `GetCostAndUsage` grouped by `SERVICE` / `REGION` | Full month-to-date, MONTHLY granularity. |
| EC2 | `GetCostAndUsageWithResources` (filter EC2-Compute, group by `RESOURCE_ID`) + `DescribeInstances` | AWS bills per instance, not per IP — IPs are mapped from instance metadata. Last 14 days. |
| Lambda | `GetCostAndUsageWithResources` (filter Lambda) grouped by `RESOURCE_ID`, and again by `USAGE_TYPE` | Usage type separates provisioned concurrency / requests / duration. Last 14 days. |
| SNS | `GetCostAndUsageWithResources` (filter SNS) grouped by `RESOURCE_ID` and `USAGE_TYPE` | Usage type separates delivery channels. Last 14 days. |

## Troubleshooting

- **Empty resource tabs / "no per-instance cost"** — resource-level data is not enabled, or there was no spend in the last 14 days.
- **AccessDenied** — the profile lacks the IAM actions above.
- **DataUnavailableException** — Cost Explorer itself is not enabled yet (can take up to 24h after first enabling).
- **EC2 row says "unknown / terminated"** — the instance incurred cost but has since been terminated or is outside your describe permissions; the cost is still shown.
