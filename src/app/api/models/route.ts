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
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const { models, baseURL, defaultModelId } = await listModels({
      provider,
      baseUrl,
    });

    return NextResponse.json({
      ok: true,
      models: models.map((m) => m.id),
      modelDetails: models,
      loadedModels: models.filter((m) => m.loaded).map((m) => m.id),
      defaultModelId,
      baseURL,
      count: models.length,
      isLmStudio: provider === "lmstudio",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConn =
      /ECONNREFUSED|fetch failed|connect|ENOTFOUND|timeout|AbortError/i.test(
        message
      );
    return NextResponse.json(
      {
        ok: false,
        error: isConn
          ? `Cannot reach provider (${message}). For LM Studio: load a model and start Local Server.`
          : message,
        models: [] as string[],
        modelDetails: [],
        defaultModelId: "",
        count: 0,
        isLmStudio: false,
      },
      { status: isConn ? 503 : 500 }
    );
  }
}
