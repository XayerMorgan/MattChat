/**
 * Lightweight Markdown → HTML for pop-out preview.
 * Covers common model output: headings, lists, emphasis, code, tables, links.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Order matters: triple/double markers before single (no lookbehind — Safari-safe)
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return s;
}

function isTableSep(cells: string[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((c) => {
      const t = c.trim();
      return t.length > 0 && /^:?-{2,}:?$/.test(t);
    })
  );
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  if (/^\|.*\|$/.test(t)) return true;
  // allow "a | b | c" without leading pipe
  return t.split("|").length >= 2 && !t.startsWith("#");
}

export function markdownToHtml(md: string): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const flushTable = (rows: string[][]) => {
    if (!rows.length) return;
    let header: string[] | null = null;
    let start = 0;
    if (rows.length >= 2 && isTableSep(rows[1])) {
      header = rows[0];
      start = 2;
    }
    out.push('<div class="md-table-wrap"><table class="md-table">');
    if (header) {
      out.push("<thead><tr>");
      for (const c of header) out.push(`<th>${inlineFormat(c)}</th>`);
      out.push("</tr></thead>");
    }
    out.push("<tbody>");
    for (let r = start; r < rows.length; r++) {
      if (isTableSep(rows[r])) continue;
      out.push("<tr>");
      for (const c of rows[r]) out.push(`<td>${inlineFormat(c)}</td>`);
      out.push("</tr>");
    }
    out.push("</tbody></table></div>");
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) {
        out.push(
          `<pre class="md-code"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join("\n"))}</code></pre>`
        );
        inCode = false;
        codeBuf = [];
        codeLang = "";
      } else {
        closeLists();
        inCode = true;
        codeLang = fence[1] || "";
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    if (isTableLine(line)) {
      closeLists();
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      flushTable(rows);
      continue;
    }

    if (!line.trim()) {
      closeLists();
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inlineFormat(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists();
      out.push("<hr />");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inlineFormat(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(line.replace(/^\s*[-*+]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inlineFormat(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      i++;
      continue;
    }

    closeLists();
    const paras: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```)/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !isTableLine(lines[i])
    ) {
      paras.push(lines[i]);
      i++;
    }
    out.push(`<p>${inlineFormat(paras.join(" "))}</p>`);
  }

  if (inCode) {
    out.push(
      `<pre class="md-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`
    );
  }
  closeLists();

  return out.join("\n");
}

/** Sanitize HTML for safe iframe/srcdoc or innerHTML (no scripts). */
export function sanitizeHtml(html: string): string {
  let s = html || "";
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  s = s.replace(/<\/?(iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  s = s.replace(/data:text\/html/gi, "data:text/plain");
  return s;
}
