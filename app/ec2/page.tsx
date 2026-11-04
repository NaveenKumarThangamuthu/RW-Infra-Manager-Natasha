"use client";
import { Suspense } from "react";
import Ec2Tab from "@/components/tabs/Ec2Tab";
import MonthPicker from "@/components/MonthPicker";
import { Loading } from "@/components/Common";

function Inner() {
  return (
    <div className="ec2-full-bleed">
      <div className="page-head">
        <div>
          <h1 className="page-title">EC2</h1>
          <p className="page-sub">
            Unified cost + health per instance. Tag inline (2.0 / 3.0 / Infra …), watch AWS status checks,
            and drill into per-server metrics — all in one table. Resource-level cost data covers the last 14 days.
          </p>
        </div>
        <MonthPicker />
      </div>
      <Ec2Tab />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
