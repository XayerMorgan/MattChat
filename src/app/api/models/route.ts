import { NextResponse } from "next/server";
import type { ProviderId } from "@/lib/providers";
import { listModels } from "@/lib/providers.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
      // Explicit signal for the UI
      hasLoadState: loadedModels.length > 0,
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
        error: isConn
          ? `Cannot reach provider: ${message}`
          : message,
        // Keep shape stable so the client can retry without UI collapse
        models: [] as string[],
        modelDetails: [],
        loadedModels: [] as string[],
        defaultModelId: "",
        count: 0,
        isLmStudio: false,
      },
      { status: isConn ? 503 : 500 }
    );
  }
}
