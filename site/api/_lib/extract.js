/**
 * Turn a source (web page, PDF, Word file, image, plain text) into passages:
 * [{ heading, body }], each roughly a paragraph or two, in reading order.
 *
 * Text is pulled out directly where possible. The AI is only used for what
 * has no text layer (scanned PDFs, photos of flyers) and for pages that block
 * servers or need a browser to render.
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { MODEL } from "./common.js";

// No URL in the User-Agent: some city sites refuse those.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_BYTES = 30 * 1024 * 1024;
const TARGET = 1200;
const clean = (s) => String(s ?? "").replace(/ /g, " ").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

// Links that have a better machine-readable form.
function rewrite(url) {
  const doc = url.match(/^https:\/\/docs\.google\.com\/document\/d\/([\w-]+)/);
  if (doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=txt`;
  const drive = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return url;
}

function kindOf(contentType, url) {
  const t = (contentType || "").split(";")[0].trim().toLowerCase();
  const ext = (url.split(/[?#]/)[0].match(/\.(\w+)$/)?.[1] || "").toLowerCase();
  if (t === "application/pdf" || ext === "pdf") return "pdf";
  if (t.includes("wordprocessingml") || ext === "docx") return "docx";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (t === "text/html" || t === "application/xhtml+xml") return "html";
  if (t.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) return "text";
  return t ? "other" : "html";
}

// ---------- splitting ----------
const BLOCK = new Set(["p", "div", "li", "ul", "ol", "table", "thead", "tbody", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "blockquote", "pre", "dl", "dt", "dd", "main", "figure", "figcaption", "header", "footer", "aside", "details", "summary"]);
const SKIP = new Set(["script", "style", "noscript", "svg", "nav", "form", "button", "iframe", "template", "select"]);

/** HTML -> [{h}|{p}] in reading order. */
function htmlBlocks(root) {
  const out = [];
  const walk = (node) => {
    for (const el of node.children ?? []) {
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      if (/^h[1-6]$/.test(tag)) {
        const t = clean(el.textContent);
        if (t) out.push({ h: t });
      } else if (![...el.querySelectorAll("*")].some((d) => BLOCK.has(d.tagName.toLowerCase()))) {
        const t = clean(el.textContent);
        if (t) out.push({ p: tag === "li" ? `• ${t}` : t });
      } else walk(el);
    }
  };
  walk(root);
  return out;
}

/** Plain text -> blocks. Markdown-style "# " lines and short title-like lines become headings. */
function textBlocks(text, heading = null) {
  const out = heading ? [{ h: heading }] : [];
  for (const para of String(text).split(/\n\s*\n|\r\n\s*\r\n/)) {
    const t = clean(para);
    if (!t) continue;
    const md = t.match(/^#{1,6}\s+(.+)$/);
    if (md && !md[1].includes("\n")) out.push({ h: md[1] });
    else out.push({ p: t });
  }
  return out;
}

function splitLong(p) {
  if (p.length <= TARGET * 2) return [p];
  const parts = [];
  let cur = "";
  for (const s of p.split(/(?<=[.!?])\s+|\n/)) {
    if (cur && cur.length + s.length > TARGET) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${s}` : s;
    while (cur.length > TARGET * 2) {
      parts.push(cur.slice(0, TARGET));
      cur = cur.slice(TARGET);
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Blocks -> passages of about TARGET characters, each tagged with its nearest heading. */
export function toPassages(blocks) {
  const out = [];
  let heading = null;
  let body = [];
  const flush = () => {
    const text = body.join("\n").trim();
    if (text) out.push({ heading, body: text });
    body = [];
  };
  for (const b of blocks) {
    if (b.h) {
      flush();
      heading = b.h.slice(0, 300);
      continue;
    }
    for (const piece of splitLong(b.p)) {
      if (body.length && body.join("\n").length + piece.length > TARGET) flush();
      body.push(piece);
    }
  }
  flush();
  return out;
}

// ---------- AI fallbacks ----------
const TRANSCRIBE = "Transcribe all of the text in this file faithfully, in reading order, as plain text. Mark headings with '# '. Put a blank line between paragraphs. Separate pages with a line '# Page N'. Describe charts or maps in one short line in [brackets]. Do not summarize or add anything.";

async function transcribe(client, block) {
  const stream = client.messages.stream({ model: MODEL, max_tokens: 32000, messages: [{ role: "user", content: [block, { type: "text", text: TRANSCRIBE }] }] });
  const msg = await stream.finalMessage();
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// For pages that refuse servers or render with JavaScript: let the AI fetch it.
async function aiFetch(client, url) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, max_content_tokens: 80000 }],
    messages: [{ role: "user", content: `Fetch ${url} with web_fetch. Reply only "done".` }],
  });
  for (const b of msg.content) {
    if (b.type !== "web_fetch_tool_result" || b.content?.type !== "web_fetch_result") continue;
    const src = b.content.content?.source;
    if (src?.type === "text") return { text: src.data, title: b.content.content?.title };
    if (src?.type === "base64" && src.media_type === "application/pdf") return { pdf: Buffer.from(src.data, "base64") };
  }
  return null;
}

// ---------- per format ----------
async function fromPdf(client, buf) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const meta = await pdf.getMetadata().catch(() => null);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const chars = text.join("").replace(/\s/g, "").length;
  // A text layer averaging under ~200 characters a page is probably a scan.
  if (chars < 200 * Math.min(totalPages, 5)) {
    if (buf.byteLength > 30 * 1024 * 1024 || totalPages > 100) throw new Error("This PDF is a scan and too large for the AI to read (over 100 pages or 30 MB).");
    const t = await transcribe(client, { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") } });
    return { blocks: textBlocks(t), title: meta?.info?.Title, how: "AI read the scanned PDF" };
  }
  const blocks = text.flatMap((page, i) => textBlocks(page, `Page ${i + 1}`));
  return { blocks, title: meta?.info?.Title, how: `PDF, ${totalPages} pages` };
}

function fromHtml(html, url) {
  const { document } = parseHTML(html);
  const pageTitle = clean(document.querySelector("title")?.textContent);
  let article = null;
  try {
    article = new Readability(parseHTML(html).document, { charThreshold: 300 }).parse();
  } catch {}
  let blocks = article?.content ? htmlBlocks(parseHTML(`<!doctype html><html><body>${article.content}</body></html>`).document.body) : [];
  if (blocks.reduce((n, b) => n + (b.p?.length ?? 0), 0) < 400) blocks = htmlBlocks(document.body ?? document.documentElement);
  return { blocks, title: clean(article?.title) || pageTitle, publisher: clean(article?.siteName) || null, how: "Web page" };
}

/**
 * Read a source. -> { passages, title, publisher, how }
 * Throws an Error with a plain-language message when it can't be read.
 */
export async function readSource(client, url) {
  let r;
  let res = null;
  try {
    r = await fetch(rewrite(url), {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    r = null;
  }
  if (r?.ok) {
    if (Number(r.headers.get("content-length")) > MAX_BYTES) throw new Error("This file is over 30 MB.");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error("This file is over 30 MB.");
    const kind = kindOf(r.headers.get("content-type"), r.url || url);
    if (kind === "pdf") res = await fromPdf(client, buf);
    else if (kind === "docx") {
      const { value } = await mammoth.convertToHtml({ buffer: buf });
      res = { blocks: htmlBlocks(parseHTML(`<!doctype html><html><body>${value}</body></html>`).document.body), how: "Word document" };
    } else if (kind === "image") {
      const media = (r.headers.get("content-type") || "").split(";")[0];
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(media)) throw new Error("Images must be PNG, JPEG, WebP, or GIF.");
      if (buf.byteLength > 5 * 1024 * 1024) throw new Error("Images must be under 5 MB for the AI to read.");
      res = { blocks: textBlocks(await transcribe(client, { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } })), how: "AI read the image" };
    } else if (kind === "text") res = { blocks: textBlocks(buf.toString("utf8")), how: "Text file" };
    else if (kind === "html") res = fromHtml(buf.toString("utf8"), url);
    else throw new Error(`DataSponge can't read this kind of file (${r.headers.get("content-type")}).`);
  }
  const words = (b) => (b ?? []).reduce((n, x) => n + (x.p?.length ?? 0), 0);
  // Blocked, missing, or a page that needs a browser: let the AI fetch it.
  if (!res || words(res.blocks) < 300) {
    const got = await aiFetch(client, url).catch(() => null);
    if (got?.pdf) res = await fromPdf(client, got.pdf);
    else if (got?.text && got.text.length > words(res?.blocks)) res = { blocks: textBlocks(got.text), title: got.title || res?.title, how: "Fetched by the AI" };
  }
  if (!res || words(res.blocks) < 80) {
    throw new Error(r && !r.ok ? `The site answered ${r.status} and the AI couldn't open it either. Try uploading the file instead.` : "No readable text was found. If it's a scan or a page that needs signing in, upload the file instead.");
  }
  return { passages: toPassages(res.blocks), title: res.title || null, publisher: res.publisher || null, how: res.how };
}
