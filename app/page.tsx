import { Suspense } from "react";
import Dashboard from "@/components/screens/dashboard/Dashboard";
import { ScreenSkeleton } from "@/components/natasha/primitives";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
