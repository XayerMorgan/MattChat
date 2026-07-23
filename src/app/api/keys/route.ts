import { NextResponse } from "next/server";
import {
  deleteKey,
  listKeySlotsPublic,
  upsertKey,
  type KeySlotId,
} from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List key slots with masked secrets only */
export async function GET() {
  return NextResponse.json({
    ok: true,
    slots: listKeySlotsPublic(),
  });
}

/** Save / update a key (server-side file; never returned in full) */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const id = body.id as KeySlotId;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const slot = upsertKey({
      id,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      clearKey: Boolean(body.clearKey),
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      label: typeof body.label === "string" ? body.label : undefined,
    });

    return NextResponse.json({ ok: true, slot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") as KeySlotId | null;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    deleteKey(id);
    return NextResponse.json({ ok: true, slots: listKeySlotsPublic() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
