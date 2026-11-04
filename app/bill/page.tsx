import BillTab from "@/components/tabs/BillTab";
import BillHistoryChart from "@/components/BillHistoryChart";
import MonthPicker from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Full Bill</h1>
          <p className="page-sub">Every service line for the month plus the record-type breakdown — the complete bill, nothing truncated.</p>
        </div>
        <MonthPicker />
      </div>
      <BillHistoryChart />
      <BillTab />
    </>
  );
}
