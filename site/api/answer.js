/**
 * POST /api/answer  { question }  (Authorization: Bearer <DataSponge session>)
 *
 * Answers a question from DataSponge's Sources only. The AI searches the
 * passages (the same public search Flood Chat uses) and either writes an
 * answer with the quote and sources it relied on, or says the sources don't
 * cover it. The editor saves answers as draft Q/A; nothing is published here.
 *
 * Editors and admins only. Needs ANTHROPIC_API_KEY.
 */
import { Anthropic, MODEL, TERM_FIELDS, json, memberRole, rpc, aiError } from "./_lib/common.js";

const SEARCH = {
  name: "search_sources",
  description: "Search the text of DataSponge's sources. Returns numbered passages. Use plain keywords; try other words if the first search misses.",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
};
const ANSWER = {
  name: "give_answer",
  description: "Give the answer, or say the sources don't cover it. Call once, at the end.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      answerable: { type: "boolean", description: "True only if the passages answer the question." },
      question: { type: "string", description: "The question, tidied up (fix typos, end with ?), keeping its meaning." },
      answer: { type: "string", description: "Two to four short, plain sentences built only from the passages. Empty if not answerable." },
      quote: { type: "string", description: "The passage text that best supports the answer, copied exactly (under 300 characters). Empty if not answerable." },
      passages: { type: "array", items: { type: "integer" }, description: "Numbers of the passages the answer relies on." },
      ...TERM_FIELDS,
      missing: { type: "string", description: "If not answerable: what kind of source would answer it. Otherwise empty." },
    },
    required: ["answerable", "question", "answer", "quote", "passages", "categories", "audiences", "action_stages", "missing"],
    additionalProperties: false,
  },
};

const SYSTEM = `You answer questions for DataSponge, a library of flood help for New York City residents, using only its sources.

Search the sources (a few searches with different words is fine), then call give_answer once.
- Answer only from the passages you found. Never fill gaps from general knowledge; if the passages don't answer it, set answerable to false and say what kind of source would.
- Two to four short sentences for someone in a stressful moment. Keep numbers, deadlines, phone numbers, and program names exactly as the passages state them.
- A partial answer is fine if it's useful and accurate; don't stretch a passage to cover what it doesn't say.`;

export async function POST(request) {
  const authorization = request.headers.get("authorization");
  const role = await memberRole(authorization);
  if (!["editor", "admin"].includes(role)) return json(403, { error: "Only DataSponge editors and admins can use AI answers." });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "Answering isn't set up yet: the site needs an ANTHROPIC_API_KEY." });

  const { question } = await request.json().catch(() => ({}));
  const q = String(question ?? "").trim().slice(0, 500);
  if (q.length < 5) return json(400, { error: "Type a question first." });

  const client = new Anthropic();
  const found = []; // passage number - 1 -> passage
  const messages = [{ role: "user", content: `Question: ${q}` }];
  try {
    for (let turn = 0; turn < 6; turn++) {
      const last = turn === 5;
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [SEARCH, ANSWER],
        tool_choice: last ? { type: "tool", name: ANSWER.name } : { type: "any" },
        messages,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason === "refusal") return json(422, { error: "The AI declined this question." });
      const answer = response.content.find((b) => b.type === "tool_use" && b.name === ANSWER.name);
      if (answer) {
        const a = typeof answer.input === "string" ? JSON.parse(answer.input) : answer.input;
        const used = [...new Set(a.passages)].map((n) => found[n - 1]).filter(Boolean);
        const sources = [...new Map(used.map((p) => [p.source_id, { id: p.source_id, title: p.title, publisher: p.publisher, url: p.url }])).values()];
        const answerable = a.answerable && a.answer.trim() && sources.length > 0;
        return json(200, { answerable: Boolean(answerable), fields: a, sources, checked_at: new Date().toISOString().slice(0, 10) });
      }
      const results = [];
      for (const call of response.content.filter((b) => b.type === "tool_use" && b.name === SEARCH.name)) {
        const hits = await rpc("fc_search_sources", { q: String(call.input?.query ?? q), max_results: 8 }).catch(() => []);
        const lines = hits.map((h) => {
          let n = found.findIndex((f) => f.source_id === h.source_id && f.passage === h.passage) + 1;
          if (!n) n = found.push(h);
          return `[${n}] ${h.title || h.url}${h.heading ? ` — ${h.heading}` : ""}\n${h.passage}`;
        });
        results.push({ type: "tool_result", tool_use_id: call.id, content: lines.join("\n\n") || "No passages matched. Try other words." });
      }
      messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
    }
    return json(502, { error: "The AI didn't finish. Try again." });
  } catch (err) {
    const known = aiError(err);
    if (known) return json(known[0], { error: known[1] });
    throw err;
  }
}
