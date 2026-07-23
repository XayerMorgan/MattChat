import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_TEXT = 120_000;

function truncate(text: string) {
  if (text.length <= MAX_TEXT) return { text, truncated: false };
  return {
    text:
      text.slice(0, MAX_TEXT) +
      `\n\n[… truncated; ${text.length - MAX_TEXT} characters omitted]`,
    truncated: true,
  };
}

/**
 * Omnimodal extract: PDF / DOCX / plain text → { text, pages?, truncated }
 * Images are handled client-side as vision data URLs (not here).
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / (1024 * 1024)} MB)` },
        { status: 400 }
      );
    }

    const name = file.name || "upload";
    const mime = (file.type || "").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());

    // PDF
    if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      const joined = Array.isArray(text) ? text.join("\n\n") : String(text || "");
      const cleaned = joined.replace(/\s+\n/g, "\n").trim();
      if (!cleaned) {
        return NextResponse.json(
          {
            error:
              "No extractable text in this PDF (may be scanned/image-only). Try OCR externally or attach page images.",
          },
          { status: 422 }
        );
      }
      const { text: out, truncated } = truncate(cleaned);
      return NextResponse.json({
        ok: true,
        kind: "pdf",
        name,
        mime: mime || "application/pdf",
        pages: totalPages,
        text: out,
        truncated,
        chars: out.length,
      });
    }

    // DOCX
    if (
      mime.includes("wordprocessingml") ||
      mime === "application/msword" ||
      /\.docx$/i.test(name)
    ) {
      if (/\.doc$/i.test(name) && !/\.docx$/i.test(name)) {
        return NextResponse.json(
          {
            error:
              "Legacy .doc is not supported. Save as .docx or paste the text.",
          },
          { status: 422 }
        );
      }
      const result = await mammoth.extractRawText({ buffer: buf });
      const cleaned = (result.value || "").trim();
      if (!cleaned) {
        return NextResponse.json(
          { error: "No extractable text in this document." },
          { status: 422 }
        );
      }
      const { text: out, truncated } = truncate(cleaned);
      return NextResponse.json({
        ok: true,
        kind: "docx",
        name,
        mime: mime || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        text: out,
        truncated,
        chars: out.length,
        warnings: result.messages?.map((m) => m.message) || [],
      });
    }

    // Plain / structured text
    if (
      mime.startsWith("text/") ||
      mime === "application/json" ||
      mime === "application/xml" ||
      mime === "application/rtf" ||
      /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|log|rtf|tex|yml|yaml|ini|cfg|env)$/i.test(
        name
      )
    ) {
      const raw = buf.toString("utf8");
      const { text: out, truncated } = truncate(raw);
      return NextResponse.json({
        ok: true,
        kind: "text",
        name,
        mime: mime || "text/plain",
        text: out,
        truncated,
        chars: out.length,
      });
    }

    return NextResponse.json(
      {
        error: `Unsupported type for text extract (${mime || "unknown"}). Use PDF, DOCX, text, or image.`,
      },
      { status: 415 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
