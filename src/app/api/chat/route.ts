import type { ChatMessage, SourceConfig } from "@/lib/providers";
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

  const enableThinking = body.source.enableThinking === true;
  const maxTokens = resolveMaxTokens(body.source);
  const messages = prepareMessagesForSpeed(rawMessages, body.source);

  const encoder = new TextEncoder();
  const started = Date.now();
  let firstTokenAt: number | null = null;
  let firstAnswerAt: number | null = null;

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
          ...(remappedFrom
            ? {
                remappedFrom,
                note: `Using already-loaded ${model} (refused to load ${remappedFrom})`,
              }
            : {}),
        });

        // Build OpenAI-compatible body. Extra fields are ignored by servers
        // that don't support them; Qwen/LM Studio use them to skip CoT.
        const createBody: Record<string, unknown> = {
          model,
          messages,
          temperature: body.source.temperature ?? (enableThinking ? 0.7 : 0.5),
          max_tokens: maxTokens,
          stream: true,
        };

        if (!enableThinking) {
          // Qwen3 / many local templates
          createBody.enable_thinking = false;
          createBody.chat_template_kwargs = { enable_thinking: false };
          // Some llama.cpp / LM Studio builds
          createBody.reasoning = false;
          // Nemotron (and some OpenAI-compat reasoning ports): only this
          // fully skips reasoning tokens. `reasoning: false` is ignored.
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
            // If user disabled thinking but model still streams it, still show it
            if (firstTokenAt === null) firstTokenAt = Date.now();
            send({ type: "thinking", text: reasoning });
          }

          const rawContent =
            typeof delta.content === "string" ? delta.content : "";
          if (!rawContent) continue;

          if (firstTokenAt === null) firstTokenAt = Date.now();

          if (enableThinking) {
            const { thinking, content } = splitter.push(rawContent);
            if (thinking) send({ type: "thinking", text: thinking });
            if (content) {
              if (firstAnswerAt === null) firstAnswerAt = Date.now();
              send({ type: "delta", text: content });
            }
          } else {
            // Fast path: still strip accidental <think> tags if model ignores flags
            const { thinking, content } = splitter.push(rawContent);
            if (thinking) send({ type: "thinking", text: thinking });
            if (content) {
              if (firstAnswerAt === null) firstAnswerAt = Date.now();
              send({ type: "delta", text: content });
            }
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
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
