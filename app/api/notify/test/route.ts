/**
 * One-shot test endpoint — verifies the Telegram alert pipeline works.
 * Hit GET /api/notify/test after setting TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * (+ optional TELEGRAM_TOPIC_ID) to send a silent test message to the channel.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendTest } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await sendTest();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
