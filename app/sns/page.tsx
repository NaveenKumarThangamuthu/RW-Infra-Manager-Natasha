import SnsTab from "@/components/tabs/SnsTab";
import SnsHealthBars from "@/components/SnsHealthBars";

export default function Page() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">SNS — cost per topic</h1>
          <p className="page-sub">Per-topic spend plus delivery-channel usage breakdown. Last 14 days.</p>
        </div>
      </div>
      <SnsHealthBars />
      <SnsTab />
    </>
  );
}
