import { NextResponse } from "next/server";
import { connectionManager } from "@/lib/connections.server";
import { getHostConfig } from "@/lib/host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public host status — safe for any client.
 * Used to show Local vs Server mode and capacity.
 */
export async function GET() {
  const status = connectionManager.publicStatus();
  const cfg = getHostConfig();
  return NextResponse.json({
    ...status,
    allowClientBaseUrl: cfg.allowClientBaseUrl,
  });
}
