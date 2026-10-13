/**
 * POST /api/source-read  { source_id, url, existing?: string[] }  (Authorization: Bearer <DataSponge session>)
 *
 * Reads one source, saves its text to DataSponge as searchable passages, and
 * returns the questions it answers. The editor saves those as draft Q/A for a
 * person to review; nothing here publishes anything.
 *
 * Editors and admins only. Every write uses the caller's own token, so the
 * database's access rules apply. Needs ANTHROPIC_API_KEY.
 */
import { Anthropic, MODEL, TERM_FIELDS, json, memberRole, rpc, aiError } from "./_lib/common.js";
import { readSource } from "./_lib/extract.js";

const MAX_CHARS = 150_000; // about 40k tokens of source text for the AI

const ITEM = {
  type: "object",
  properties: {
    question: { type: "string", description: "Asked the way a New Yorker would ask it, ending with ?" },
    answer: { type: "string", description: "Two to four short, plain sentences using only what this source says." },
    quote: { type: "string", description: "The sentence(s) from the source that support the answer, copied exactly (under 300 characters)." },
    ...TERM_FIELDS,
    duplicate_of: { type: ["integer", "null"], description: "Number of the existing question this repeats, or null." },
  },
  required: ["question", "answer", "quote", "categories", "audiences", "action_stages", "duplicate_of"],
  additionalProperties: false,
};
const TOOL = {
  name: "save_questions",
  description: "Save what this source is and the questions it answers.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The source's own title." },
      publisher: { type: ["string", "null"], description: "Who published it, e.g. NYC Emergency Management." },
      summary: { type: "string", description: "One or two sentences: what this source covers." },
      about_flooding: { type: "boolean", description: "False if this source has nothing useful about flooding." },
      items: { type: "array", items: ITEM },
    },
    required: ["title", "publisher", "summary", "about_flooding", "items"],
    additionalProperties: false,
  },
};

const SYSTEM = `You read sources for DataSponge, a library of flood help for New York City residents. Its Q/A list answers questions for Flood Chat and other tools.

Read the source, then call save_questions once with the questions it answers well.
- Ask what a resident, renter, homeowner, or small business owner in NYC would actually ask about flooding: preparing, insurance, cleanup, mold, repairs, money, tenant rights, health, safety, recovery, flood risk.
- Usually 3 to 12 questions; more only for long, practical guides. None if the source isn't useful for flooding (set about_flooding to false).
- Answers: two to four short sentences for someone in a stressful moment. Use only what the source says. Keep numbers, deadlines, phone numbers, and program names exactly as the source states them. No legal or medical advice beyond what the source says.
- Each question must be answerable from this source alone, and the quote must be copied word for word from it.
- If an existing question (numbered below) already asks the same thing, set duplicate_of to its number instead of writing a near-copy.
- Don't write questions about the source itself ("What does this report say?").`;

export async function POST(request) {
  const authorization = request.headers.get("authorization");
  const role = await memberRole(authorization);
  if (!["editor", "admin"].includes(role)) return json(403, { error: "Only DataSponge editors and admins can read sources." });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "Reading isn't set up yet: the site needs an ANTHROPIC_API_KEY." });

  const body = await request.json().catch(() => ({}));
  const sourceId = String(body.source_id ?? "");
  const url = String(body.url ?? "").trim();
  if (!/^[0-9a-f-]{36}$/.test(sourceId) || !/^https?:\/\/\S+$/.test(url)) return json(400, { error: "Missing source." });
  const existing = (Array.isArray(body.existing) ? body.existing : []).map(String).slice(0, 600);

  await rpc("fc_start_reading", { source: sourceId }, authorization);
  const client = new Anthropic();
  let read;
  try {
    read = await readSource(client, url);
  } catch (err) {
    const problem = aiError(err)?.[1] ?? err.message;
    await rpc("fc_save_reading", { source: sourceId, title: null, publisher: null, summary: null, chunks: [], problem }, authorization).catch(() => {});
    return json(422, { error: problem });
  }

  let text = "";
  for (const p of read.passages) {
    const piece = `${p.heading ? `## ${p.heading}\n` : ""}${p.body}\n\n`;
    if (text.length + piece.length > MAX_CHARS) break;
    text += piece;
  }
  const truncated = text.length < read.passages.reduce((n, p) => n + p.body.length, 0) * 0.95;
  let out;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: `Existing questions in DataSponge:\n${existing.map((q, i) => `${i + 1}. ${q}`).join("\n") || "(none yet)"}\n\n<source url="${url}" title="${(read.title ?? "").replaceAll('"', "'")}">\n${text}\n</source>${truncated ? "\n(The source is long; this is the first part.)" : ""}`,
      }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new Error("The AI declined to read this source.");
    out = response.content.find((b) => b.type === "tool_use")?.input;
    if (typeof out === "string") out = JSON.parse(out);
    if (!out) throw new Error("The AI didn't finish reading. Try again.");
  } catch (err) {
    const [status, problem] = aiError(err) ?? [502, err.message];
    await rpc("fc_save_reading", { source: sourceId, title: null, publisher: null, summary: null, chunks: [], problem }, authorization).catch(() => {});
    return json(status, { error: problem });
  }

  // Passages are kept even for sources that aren't about flooding; they just add no Q/A.
  await rpc("fc_save_reading", { source: sourceId, title: out.title || read.title, publisher: out.publisher || read.publisher, summary: out.summary, chunks: read.passages, problem: null }, authorization);
  const items = out.about_flooding ? out.items.filter((i) => i.question.trim() && i.answer.trim()) : [];
  return json(200, {
    title: out.title || read.title,
    publisher: out.publisher || read.publisher,
    summary: out.summary,
    about_flooding: out.about_flooding,
    how: read.how,
    passages: read.passages.length,
    truncated,
    items: items.map((i) => ({ ...i, duplicate_of: i.duplicate_of && existing[i.duplicate_of - 1] ? existing[i.duplicate_of - 1] : null })),
    checked_at: new Date().toISOString().slice(0, 10),
  });
}
