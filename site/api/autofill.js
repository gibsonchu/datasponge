/**
 * POST /api/autofill  { name, hint? }  (Authorization: Bearer <DataSponge session>)
 *
 * Looks up a flood-help service on the web and returns draft values for the
 * editor's service form. Nothing is saved here: the editor fills the form and a
 * person checks every field before saving.
 *
 * Only active DataSponge editors and admins may call it (checked against the
 * database with the caller's own token), so the AI bill can't be run up by
 * strangers. Needs ANTHROPIC_API_KEY in the project's environment.
 */
import Anthropic from "@anthropic-ai/sdk";
import taxonomy from "../standards/taxonomy.json" with { type: "json" };
import config from "../config.json" with { type: "json" };
import places from "../editor/nyc-places.json" with { type: "json" };

const keys = (dim) => taxonomy.filter((t) => t.dimension === dim).map((t) => t.key);
const SERVICE_TYPES = [
  "referral", "financial_help", "insurance_help", "legal_help", "tenant_support", "small_business_support", "emergency_response",
  "cleanup", "mold_remediation", "mold_assessment", "plumbing", "sewer_cleaning", "waterproofing", "backwater_valve", "sump_pump_install",
  "education", "workforce", "planning", "preparedness", "community", "advocacy", "green_infrastructure", "climate_resilience",
];
const str = { type: ["string", "null"] };
const list = (items) => ({ type: "array", items });

// The editor's service form, as a strict tool. Every field is required so the
// model states null for anything it couldn't confirm instead of omitting it.
const FIELDS = {
  found: { type: "boolean", description: "False if you could not identify this organization or service with confidence." },
  title: { type: "string", description: "The service's name as the organization publishes it." },
  provider_name: str,
  summary: { type: "string", description: "Two or three plain-language sentences: what they do for people dealing with flooding in NYC. No marketing language." },
  service_type: { type: "string", enum: [...SERVICE_TYPES, "other"] },
  service_type_other: { ...str, description: 'Only when service_type is "other": a short type such as "Roof repair".' },
  areas: {
    ...list({ type: "string", enum: places.map((p) => p.id) }),
    description: 'Where they serve. "citywide" for all of NYC; otherwise borough ids (e.g. "brooklyn") and/or neighborhood ids (e.g. "brooklyn/red-hook"). Pick the most specific that is accurate.',
  },
  categories: list({ type: "string", enum: keys("topic") }),
  audiences: list({ type: "string", enum: keys("audience") }),
  action_stages: list({ type: "string", enum: keys("stage") }),
  phone: str,
  email: str,
  contact_url: { ...str, description: "Best page for someone to get this help (intake form or program page)." },
  provider_url: { ...str, description: "The organization's homepage." },
  availability: { type: "string", enum: ["yes", "no", "unsure"], description: "Are they taking new people now? unsure if no source says." },
  availability_note: { ...str, description: 'Short detail if a source gives one, e.g. "Waitlist until March". Null otherwise.' },
  eligibility: str,
  cost_min: { type: "string", enum: ["free", "1", "2", "3", "4", "5", "unknown"], description: "Cheapest typical cost: free, 1 = under $100, 2 = $100-500, 3 = $500-2,000, 4 = $2,000-10,000, 5 = over $10,000, or unknown." },
  cost_max: { type: "string", enum: ["free", "1", "2", "3", "4", "5", "unknown"], description: "Most expensive typical cost on the same scale." },
  open_24_7: { type: "boolean", description: "True only if a source says they operate 24 hours, 7 days." },
  weekly_hours: list({
    type: "object",
    properties: {
      day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
      open: { type: "string", description: "24-hour HH:MM" },
      close: { type: "string", description: "24-hour HH:MM" },
    },
    required: ["day", "open", "close"],
    additionalProperties: false,
  }),
  service_languages: list({ type: "string" }),
  accessibility: str,
  source_url: { type: "string", description: "The page that best supports these details." },
  source_organization: str,
  notes: { type: "string", description: "Anything the editor should double-check, e.g. conflicting phone numbers or an outdated page. Empty if nothing." },
};
const FILL_TOOL = {
  name: "fill_service_form",
  description: "Submit the service details you found. Call this exactly once, after researching.",
  strict: true,
  input_schema: { type: "object", properties: FIELDS, required: Object.keys(FIELDS), additionalProperties: false },
};

const SYSTEM = `You help staff of DataSponge, a directory of flood help for New York City residents, add a service listing.
Research the named organization or program on the web, then call fill_service_form once.

- Use only facts you found on the organization's own site or another reliable source. Never guess a phone number, email, address or eligibility rule; use null when you couldn't confirm it.
- Prefer the organization's own pages over directories and news.
- Describe the help as it relates to flooding: preparing, cleanup, repairs, insurance, money, tenant rights, recovery.
- If the name matches several organizations, pick the one serving NYC flood-affected people and say so in notes. If you can't identify it, set found to false.
- availability: yes unless a source says they are paused, closed, or no longer running; unsure if you can't tell.
- weekly_hours: only days and times a source states; empty list if unknown. Use open_24_7 for round-the-clock services.
- cost: free programs are "free" for both ends; leave "unknown" rather than guess.
- Write for a resident in a stressful moment: short, concrete sentences.`;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function memberRole(authorization) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const r = await fetch(`${config.url}/rest/v1/rpc/fc_my_membership`, {
    method: "POST",
    headers: { apikey: config.key, Authorization: authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return null;
  const m = await r.json();
  return m?.active ? m.role : null;
}

function sourcesOf(content) {
  const seen = new Map();
  for (const block of content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content) if (r.type === "web_search_result" && !seen.has(r.url)) seen.set(r.url, r.title || r.url);
  }
  return [...seen].slice(0, 8).map(([url, title]) => ({ url, title }));
}

export async function POST(request) {
  const role = await memberRole(request.headers.get("authorization"));
  if (!["editor", "admin"].includes(role)) return json(403, { error: "Only DataSponge editors and admins can use lookup." });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "Lookup isn't set up yet: the site needs an ANTHROPIC_API_KEY." });

  const { name, hint } = await request.json().catch(() => ({}));
  const query = String(name ?? "").trim().slice(0, 200);
  if (query.length < 3) return json(400, { error: "Type the service or organization name first." });

  const client = new Anthropic();
  const messages = [{ role: "user", content: `Service to look up: ${query}${hint ? `\nContext from the editor: ${String(hint).slice(0, 300)}` : ""}` }];
  const sources = [];
  try {
    // Web search can pause a long turn; resume until the form is submitted.
    for (let turn = 0; turn < 4; turn++) {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, FILL_TOOL],
        messages,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      sources.push(...sourcesOf(response.content));
      if (response.stop_reason === "refusal") return json(422, { error: "The lookup was declined for this name. Fill the form by hand." });
      const fill = response.content.find((b) => b.type === "tool_use" && b.name === "fill_service_form");
      if (fill) {
        const fields = typeof fill.input === "string" ? JSON.parse(fill.input) : fill.input;
        if (!fields.found) return json(404, { error: `Couldn't find a clear match for “${query}”. Try the full official name, or fill the form by hand.`, notes: fields.notes, sources });
        return json(200, { fields, sources: [...new Map(sources.map((s) => [s.url, s])).values()].slice(0, 8), checked_at: new Date().toISOString().slice(0, 10) });
      }
      if (response.stop_reason !== "pause_turn") {
        // Ended without the form: ask once more for the tool call.
        messages.push({ role: "assistant", content: response.content }, { role: "user", content: "Now call fill_service_form with what you found." });
        continue;
      }
      messages.push({ role: "assistant", content: response.content });
    }
    return json(502, { error: "The lookup didn't finish. Try again, or fill the form by hand." });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: "Lookup is busy right now. Try again in a minute." });
    if (err instanceof Anthropic.AuthenticationError) return json(503, { error: "Lookup isn't set up correctly: the site's ANTHROPIC_API_KEY was rejected." });
    if (err instanceof Anthropic.APIError) return json(502, { error: `Lookup failed (${err.status ?? "network"}). Try again, or fill the form by hand.` });
    throw err;
  }
}
