import DataTransferTab from "@/components/tabs/DataTransferTab";
import DataFlows from "@/components/DataFlows";
import MonthPicker from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Data Transfer</h1>
          <p className="page-sub">Transfer cost split into public-IP vs private-IP traffic, plus a flow-level view showing every direction.</p>
        </div>
        <MonthPicker />
      </div>
      <DataTransferTab />
      <DataFlows />
    </>
  );
}
