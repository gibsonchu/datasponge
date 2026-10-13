/**
 * POST /api/describe-story  { image_url, hint? }  (Authorization: Bearer <DataSponge session>)
 *
 * Looks at a story image and drafts its fields: a caption, an image
 * description for screen readers, type, when, setting, kind of flooding, and
 * tags. The Editor only fills blank fields and a person checks them before
 * publishing; nothing is saved here. Editors and admins only.
 */
import { Anthropic, MODEL, json, memberRole, aiError } from "./_lib/common.js";
import { KINDS, STAGES, AUDIENCES, SETTINGS, BUILDINGS, HAZARDS, PURPOSES } from "../editor/stories-model.js";

const keys = (list) => list.map(([k]) => k);
const orNull = (list) => ({ type: ["string", "null"], enum: [...keys(list), null] });
const TOOL = {
  name: "describe_story",
  description: "Save the draft fields for this story image.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "One or two plain sentences saying what the image shows and why it matters for flooding in NYC. Don't invent names, places, dates, or quotes." },
      alt_text: { type: "string", description: "A short, literal description for screen readers (under 150 characters)." },
      kind: { type: "string", enum: keys(KINDS) },
      stage: { type: "string", enum: keys(STAGES), description: "When this is useful: before, during, or after a flood, or general." },
      audience: { type: "string", enum: keys(AUDIENCES) },
      setting: orNull(SETTINGS),
      hazard_type: orNull(HAZARDS),
      building_types: { type: "array", items: { type: "string", enum: keys(BUILDINGS) } },
      purposes: { type: "array", items: { type: "string", enum: keys(PURPOSES) } },
      tags: { type: "array", items: { type: "string" }, description: "3 to 6 short lowercase words people might search for." },
    },
    required: ["text", "alt_text", "kind", "stage", "audience", "setting", "hazard_type", "building_types", "purposes", "tags"],
    additionalProperties: false,
  },
};
const SYSTEM = `You help staff of DataSponge, a library of flood help for New York City, catalog story images (photos, illustrations, diagrams, maps) that Flood Chat shows residents as real examples.
Look at the image and call describe_story once. Describe only what you can see or read in it. If text in the image names a person, place, or date, you may use it; never guess one. Use null or an empty list when unsure.`;

export async function POST(request) {
  const role = await memberRole(request.headers.get("authorization"));
  if (!["editor", "admin"].includes(role)) return json(403, { error: "Only DataSponge editors and admins can use AI descriptions." });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "AI descriptions aren't set up yet: the site needs an ANTHROPIC_API_KEY." });
  const { image_url, hint } = await request.json().catch(() => ({}));
  const url = String(image_url ?? "").trim();
  if (!/^https:\/\/\S+$/.test(url)) return json(400, { error: "The image needs a full https:// link." });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "url", url } },
          { type: "text", text: hint ? `What staff wrote so far: ${String(hint).slice(0, 1000)}` : "Describe this story image." },
        ],
      }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return json(422, { error: "The AI declined to describe this image." });
    const out = response.content.find((b) => b.type === "tool_use")?.input;
    if (!out) return json(502, { error: "The AI didn't finish. Try again." });
    return json(200, { fields: typeof out === "string" ? JSON.parse(out) : out });
  } catch (err) {
    const known = aiError(err);
    if (known) return json(known[0], { error: known[1].replace("AI request failed", "AI couldn't open the image or failed") });
    throw err;
  }
}
