import { NextResponse } from "next/server";
import type { ProviderId } from "@/lib/providers";
import {
  capacityResponse,
  clientMetaFromRequest,
  connectionManager,
} from "@/lib/connections.server";
import { listModels } from "@/lib/providers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const meta = clientMetaFromRequest(request);
  const slot = connectionManager.tryAcquire({
    kind: "models",
    clientId: meta.clientId,
    remote: meta.remote,
  });
  if (!slot.ok) {
    return capacityResponse({
      active: slot.active,
      max: slot.max,
      reason: slot.reason,
      retryAfterSec: slot.retryAfterSec,
    });
  }

  try {
    const body = await request.json();
    const provider = body.provider as ProviderId;
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : undefined;

    if (!provider) {
      return NextResponse.json(
        { ok: false, error: "provider is required" },
        { status: 400 }
      );
    }

    const { models, baseURL, defaultModelId, listSource, diagnostics } =
      await listModels({
        provider,
        baseUrl,
      });

    const loadedModels = models.filter((m) => m.loaded).map((m) => m.id);
    const host = connectionManager.publicStatus();

    return NextResponse.json({
      ok: true,
      models: models.map((m) => m.id),
      modelDetails: models,
      loadedModels,
      defaultModelId,
      baseURL,
      count: models.length,
      isLmStudio: provider === "lmstudio",
      listSource: listSource || null,
      diagnostics: diagnostics || [],
      hasLoadState: loadedModels.length > 0,
      hostMode: host.mode,
      activeConnections: host.activeConnections,
      maxConnections: host.maxConnections,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConn =
      /ECONNREFUSED|fetch failed|connect|ENOTFOUND|timeout|AbortError|Could not list/i.test(
        message
      );
    return NextResponse.json(
      {
        ok: false,
        error: isConn ? `Cannot reach provider: ${message}` : message,
        models: [] as string[],
        modelDetails: [],
        loadedModels: [] as string[],
        defaultModelId: "",
        count: 0,
        isLmStudio: false,
      },
      { status: isConn ? 503 : 500 }
    );
  } finally {
    connectionManager.release(slot.id);
  }
}
