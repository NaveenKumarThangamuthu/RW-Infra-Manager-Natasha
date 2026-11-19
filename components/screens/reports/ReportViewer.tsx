"use client";
import { Download, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ago, bytes } from "@/components/natasha/format";
import { CsvTable } from "./CsvTable";
import { KIND_META, type ReportEntry } from "./types";

const FRAME_CLASS = "block h-[70vh] min-h-[420px] w-full border-0 bg-white lg:h-[calc(100vh-230px)]";

function Body({ report }: { report: ReportEntry }) {
  if (report.kind === "csv") return <CsvTable key={report.id} url={report.viewUrl} sizeBytes={report.sizeBytes} />;
  return (
    <>
      <iframe key={report.id} src={report.viewUrl} title={report.title} className={FRAME_CLASS} />
      {report.kind === "pdf" && (
        <p className="m-0 px-5 py-2.5 text-[12.5px] text-muted-foreground lg:hidden">If the PDF does not show here, open it in a new tab.</p>
      )}
    </>
  );
}

export function ReportViewer({ report }: { report: ReportEntry }) {
  const meta = KIND_META[report.kind];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-border px-5 py-3.5">
        <div className="min-w-0">
          <div className="min-w-0 break-words text-[15px] font-semibold">{report.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <Badge size="xs" tone={meta.color}>{meta.label}</Badge>
            <span>{bytes(report.sizeBytes)}</span>
            <span title={new Date(report.modifiedAt).toLocaleString()}>Updated {ago(report.modifiedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={report.viewUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open in new tab</a>
          </Button>
          <Button asChild>
            <a href={report.downloadUrl} download={report.downloadName}><Download size={14} />Download</a>
          </Button>
          {report.alt && (
            <Button asChild>
              <a href={report.alt.url} target="_blank" rel="noopener noreferrer">{report.alt.label}</a>
            </Button>
          )}
        </div>
      </div>
      <Body report={report} />
    </Card>
  );
}
