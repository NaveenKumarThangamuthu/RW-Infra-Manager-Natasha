import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getVolumeDetail } from "@/lib/volumeDetail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOWS: Record<string, number> = {
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const windowParam = new URL(req.url).searchParams.get("window") ?? "1h";
  const windowSec = WINDOWS[windowParam] ?? WINDOWS["1h"];

  try {
    const detail = await getVolumeDetail(params.id, windowSec);
    if (!detail) return NextResponse.json({ error: "Volume not found" }, { status: 404 });
    return NextResponse.json({ ok: true, fetchedAt: new Date().toISOString(), window: windowParam, detail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
