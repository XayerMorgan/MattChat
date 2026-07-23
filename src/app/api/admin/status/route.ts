import { NextResponse } from "next/server";
import { connectionManager } from "@/lib/connections.server";
import { getHostConfig } from "@/lib/host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized — set MATTCHAT_ADMIN_TOKEN and send Bearer token" },
    { status: 401 }
  );
}

/**
 * Admin snapshot: active connections, peaks, rejects.
 * - local mode: open (single user machine)
 * - server mode: requires Authorization: Bearer $MATTCHAT_ADMIN_TOKEN
 *   (if token is empty in server mode, still open but logs a warning once)
 */
export async function GET(request: Request) {
  const cfg = getHostConfig();

  if (cfg.mode === "server" && cfg.adminToken) {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== cfg.adminToken) {
      return unauthorized();
    }
  }

  const status = connectionManager.adminStatus();
  return NextResponse.json({
    ...status,
    allowClientBaseUrl: cfg.allowClientBaseUrl,
    adminProtected: Boolean(cfg.mode === "server" && cfg.adminToken),
  });
}
