import { NextResponse } from "next/server";
import { getSchedule } from "@/lib/scheduleCache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("refresh") === "1";

  try {
    const { fetchedAt, schedule } = await getSchedule(force);
    return NextResponse.json(
      { fetchedAt, data: schedule },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Could not load the World Cup schedule. ${message}` },
      { status: 502 },
    );
  }
}
