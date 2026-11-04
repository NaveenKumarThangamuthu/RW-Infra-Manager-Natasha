import { ScanSearch } from "lucide-react";
import StubPage from "@/components/StubPage";

export const metadata = { title: "Findings · Natasha" };

export default function FindingsPage() {
  return (
    <StubPage
      title="Findings"
      tag="Security · Cross-repo"
      Icon={ScanSearch}
      subtitle="Every open finding across all synced repos — Trivy CVEs and Gitleaks secrets, deduped by sha256 fingerprint."
      cards={[
        { label: "Severity filter chips", body: "CRIT · HIGH · MED · LOW — click to filter, counts update live." },
        { label: "Scanner filter chips", body: "Trivy · Gitleaks — filter by scanner or view combined." },
        { label: "Row detail", body: "Repo · Severity · Rule · File:line · Title · First seen · Suppress. Suppression writes an audit row." },
        { label: "Bulk actions", body: "Select N findings → create fix branch, mark false-positive, or export as CSV." },
      ]}
    />
  );
}
