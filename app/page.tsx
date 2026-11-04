import Dashboard from "@/components/Dashboard";
import InfraOverviewTiles from "@/components/InfraOverviewTiles";
import MonthPicker from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Infra at a glance — GitHub security, Spring services, Lambda — and your AWS spend below.</p>
        </div>
        <MonthPicker />
      </div>
      <InfraOverviewTiles />
      <Dashboard />
    </>
  );
}
