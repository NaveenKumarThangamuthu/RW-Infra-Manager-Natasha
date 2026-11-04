import RegionsTab from "@/components/tabs/RegionsTab";
import RegionsHeatmap from "@/components/RegionsHeatmap";
import MonthPicker from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Regions</h1>
          <p className="page-sub">Region × service cost matrix — see where your bill concentrates geographically.</p>
        </div>
        <MonthPicker />
      </div>
      <RegionsHeatmap />
      <RegionsTab />
    </>
  );
}
