import { NextResponse } from "next/server";
import { testKeySlot, type KeySlotId } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const id = body.id as KeySlotId;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const result = await testKeySlot(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
