import LambdaTab from "@/components/tabs/LambdaTab";
import LambdaOhioPanel from "@/components/LambdaOhioPanel";
import LambdaBreakdown from "@/components/LambdaBreakdown";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Lambda Functions</h1>
          <p className="page-sub">
            Per-function invocations, errors, duration and usage (GB-s) from CloudWatch, plus cost by
            usage type. Last 14 days. Below: Ohio (us-east-2) functions with click-through CloudWatch Logs.
          </p>
        </div>
      </div>
      <LambdaBreakdown />
      <LambdaTab />
      <LambdaOhioPanel />
    </>
  );
}
