import { Suspense } from "react";
import Billing from "@/components/screens/Billing";
import { ScreenSkeleton } from "@/components/natasha/primitives";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <Billing />
    </Suspense>
  );
}
