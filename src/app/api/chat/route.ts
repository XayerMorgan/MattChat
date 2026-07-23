import type { ChatMessage, SourceConfig } from "@/lib/providers";
import {
  capacityResponse,
  clientMetaFromRequest,
  connectionManager,
} from "@/lib/connections.server";
import { resolveProvider } from "@/lib/providers.server";
import {
  isNemotronFamily,
  isQwenFamily,
  prepareMessagesForSpeed,
  resolveMaxTokens,
} from "@/lib/speed";
import {
  ThinkingSplitter,
  extractReasoningDelta,
  finalizeStreamOutput,
} from "@/lib/thinking";

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
          // Final chunk may include prompt/completion token counts
          stream_options: { include_usage: true },
        };

        // Fast-mode "no thinking" extras are for local / template models only.
        // xAI Grok rejects reasoning_effort "none" with HTTP 400.
        if (!enableThinking) {
          const provider = body.source.provider;
          const localish =
            provider === "lmstudio" || provider === "custom";
          if (localish) {
            if (isQwenFamily(model) || provider === "lmstudio") {
              createBody.enable_thinking = false;
              createBody.chat_template_kwargs = { enable_thinking: false };
            }
            createBody.reasoning = false;
            if (isNemotronFamily(model)) {
              createBody.reasoning_effort = "none";
            }
          }
        }

        const completion = (await client.chat.completions.create(
          createBody as unknown as Parameters<
            typeof client.chat.completions.create
          >[0]
        )) as AsyncIterable<{
          choices?: Array<{ delta?: Record<string, unknown> }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        }>;

        let promptTokens: number | null = null;
        let completionTokens: number | null = null;
        let totalTokens: number | null = null;
        let reasoningTokens: number | null = null;
        // Accumulate for end-of-stream recovery when answer never left the
        // thinking channel (unclosed tags / reasoning-only providers).
        let accThinking = "";
        let accContent = "";

        for await (const chunk of completion) {
          const usage = chunk.usage;
          if (usage) {
            if (typeof usage.prompt_tokens === "number") {
              promptTokens = usage.prompt_tokens;
            }
            if (typeof usage.completion_tokens === "number") {
              completionTokens = usage.completion_tokens;
            }
            if (typeof usage.total_tokens === "number") {
              totalTokens = usage.total_tokens;
            }
            const rt = usage.completion_tokens_details?.reasoning_tokens;
            if (typeof rt === "number") reasoningTokens = rt;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          const reasoning = extractReasoningDelta(delta);
          if (reasoning) {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            accThinking += reasoning;
            send({ type: "thinking", text: reasoning });
          }

          // Some OpenAI-compatible servers send content as an array of parts
          let rawContent = "";
          if (typeof delta.content === "string") {
            rawContent = delta.content;
          } else if (Array.isArray(delta.content)) {
            rawContent = (delta.content as unknown[])
              .map((part) => {
                if (typeof part === "string") return part;
                if (
                  part &&
                  typeof part === "object" &&
                  "text" in part &&
                  typeof (part as { text?: unknown }).text === "string"
                ) {
                  return (part as { text: string }).text;
                }
                return "";
              })
              .join("");
          }
          if (!rawContent) continue;

          if (firstTokenAt === null) firstTokenAt = Date.now();

          const { thinking, content } = splitter.push(rawContent);
          if (thinking) {
            accThinking += thinking;
            send({ type: "thinking", text: thinking });
          }
          if (content) {
            if (firstAnswerAt === null) firstAnswerAt = Date.now();
            accContent += content;
            send({ type: "delta", text: content });
          }
        }

        const tail = splitter.flush();
        if (tail.thinking) {
          accThinking += tail.thinking;
          send({ type: "thinking", text: tail.thinking });
        }
        if (tail.content) {
          if (firstAnswerAt === null) firstAnswerAt = Date.now();
          accContent += tail.content;
          send({ type: "delta", text: tail.content });
        }

        // Only recover text that is clearly an answer after think markup
        // (e.g. after </think>). Never re-emit pure CoT as a content delta.
        if (!accContent.trim() && accThinking.trim()) {
          const recovered = finalizeStreamOutput(accThinking, "");
          const extra = recovered.content.trim();
          // Guard: recovered answer must not be the entire reasoning blob
          if (
            extra &&
            extra !== accThinking.trim() &&
            extra.length < accThinking.length
          ) {
            if (firstAnswerAt === null) firstAnswerAt = Date.now();
            send({ type: "delta", text: recovered.content });
            accContent = recovered.content;
          }
        }

        send({
          type: "done",
          latencyMs: Date.now() - started,
          ttftMs: firstTokenAt ? firstTokenAt - started : null,
          answerTtftMs: firstAnswerAt ? firstAnswerAt - started : null,
          promptTokens,
          completionTokens,
          totalTokens,
          reasoningTokens,
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
