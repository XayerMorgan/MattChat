import type { ChatMessage, SourceConfig } from "@/lib/providers";
import {
  capacityResponse,
  clientMetaFromRequest,
  connectionManager,
} from "@/lib/connections.server";
import { resolveProvider } from "@/lib/providers.server";
import { prepareMessagesForSpeed, resolveMaxTokens } from "@/lib/speed";
import { ThinkingSplitter, extractReasoningDelta } from "@/lib/thinking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  source: SourceConfig;
  messages: ChatMessage[];
};

/**
 * Exactly one upstream completion request per HTTP call.
 * Counts toward concurrent connection capacity (server mode: up to 100).
 * Streams NDJSON events:
 *   { type: "meta", ... }
 *   { type: "thinking", text }
 *   { type: "delta", text }
 *   { type: "done", latencyMs, ttftMs, answerTtftMs }
 *   { type: "error", error }
 */
export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ type: "error", error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!body?.source || !Array.isArray(body.messages)) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: "source and messages are required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const rawMessages = body.messages.filter((m) => {
    if (!m?.content) return false;
    if (typeof m.content === "string") return m.content.trim().length > 0;
    if (Array.isArray(m.content)) return m.content.length > 0;
    return false;
  });
  if (!rawMessages.length) {
    return new Response(
      JSON.stringify({ type: "error", error: "No non-empty messages" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const meta = clientMetaFromRequest(request);
  const slot = connectionManager.tryAcquire({
    kind: "chat",
    clientId: meta.clientId,
    remote: meta.remote,
    provider: body.source.provider,
    model: body.source.model,
  });
  if (!slot.ok) {
    return capacityResponse({
      active: slot.active,
      max: slot.max,
      reason: slot.reason,
      retryAfterSec: slot.retryAfterSec,
    });
  }

  const enableThinking = body.source.enableThinking === true;
  const maxTokens = resolveMaxTokens(body.source);
  const messages = prepareMessagesForSpeed(rawMessages, body.source);

  const encoder = new TextEncoder();
  const started = Date.now();
  let firstTokenAt: number | null = null;
  let firstAnswerAt: number | null = null;
  const connectionId = slot.id;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };

      const splitter = new ThinkingSplitter();

      try {
        const { client, model, label, remappedFrom } = await resolveProvider(
          body.source
        );
        send({
          type: "meta",
          label,
          model,
          provider: body.source.provider,
          enableThinking,
          maxTokens,
          connectionId,
          activeConnections: slot.active,
          maxConnections: slot.max,
          ...(remappedFrom
            ? {
                remappedFrom,
                note: `Using already-loaded ${model} (refused to load ${remappedFrom})`,
              }
            : {}),
        });

        const createBody: Record<string, unknown> = {
          model,
          messages,
          temperature: body.source.temperature ?? (enableThinking ? 0.7 : 0.5),
          max_tokens: maxTokens,
          stream: true,
        };

        if (!enableThinking) {
          createBody.enable_thinking = false;
          createBody.chat_template_kwargs = { enable_thinking: false };
          createBody.reasoning = false;
          createBody.reasoning_effort = "none";
        }

        const completion = (await client.chat.completions.create(
          createBody as unknown as Parameters<
            typeof client.chat.completions.create
          >[0]
        )) as AsyncIterable<{
          choices?: Array<{ delta?: Record<string, unknown> }>;
        }>;

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          const reasoning = extractReasoningDelta(delta);
          if (reasoning) {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            send({ type: "thinking", text: reasoning });
          }

          const rawContent =
            typeof delta.content === "string" ? delta.content : "";
          if (!rawContent) continue;

          if (firstTokenAt === null) firstTokenAt = Date.now();

          const { thinking, content } = splitter.push(rawContent);
          if (thinking) send({ type: "thinking", text: thinking });
          if (content) {
            if (firstAnswerAt === null) firstAnswerAt = Date.now();
            send({ type: "delta", text: content });
          }
        }

        const tail = splitter.flush();
        if (tail.thinking) send({ type: "thinking", text: tail.thinking });
        if (tail.content) {
          if (firstAnswerAt === null) firstAnswerAt = Date.now();
          send({ type: "delta", text: tail.content });
        }

        send({
          type: "done",
          latencyMs: Date.now() - started,
          ttftMs: firstTokenAt ? firstTokenAt - started : null,
          answerTtftMs: firstAnswerAt ? firstAnswerAt - started : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", error: message });
      } finally {
        connectionManager.release(connectionId);
        controller.close();
      }
    },
    cancel() {
      connectionManager.release(connectionId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-MattChat-Connection-Id": connectionId,
      "X-MattChat-Active": String(slot.active),
      "X-MattChat-Max": String(slot.max),
    },
  });
}
