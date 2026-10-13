/**
 * Stories: choices, and conversion to and from the old Google Sheet's columns.
 *
 * No browser-only code here, so the one-time sheet import (Node) and the
 * Editor's CSV upload read the sheet the same way. Pass nyc-places.json in.
 */
export const KINDS = [["photo", "Photo"], ["art", "Illustration or Art"], ["diagram", "Diagram"], ["map", "Map"], ["education", "Explainer or Infographic"], ["story", "Quote or Personal Story"], ["video", "Video"]];
export const STAGES = [["before", "Before"], ["during", "During"], ["after", "After"], ["general", "Any Time"]];
export const AUDIENCES = [["both", "Everyone"], ["renter", "Renters"], ["owner", "Homeowners"], ["small_business", "Small Businesses"]];
export const SETTINGS = [["outside", "Outside"], ["inside", "Inside a Building"], ["both", "Both"]];
export const BUILDINGS = [["apartment", "Apartment Building"], ["basement", "Basement Unit"], ["multi_family", "Multi-Family Home"], ["neighborhood", "Whole Neighborhood"], ["school", "School"], ["single_family", "Single-Family Home"], ["small_business", "Storefront or Small Business"], ["street", "Street"]];
export const HAZARDS = [["stormwater", "Heavy Rain and Sewers"], ["street", "Street Flooding"], ["basement", "Basement Flooding"], ["coastal", "Coastal or Tidal"], ["combined", "Several Kinds"]];
export const LEVELS = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
export const PURPOSES = [
  ["understand_risk", "Understand Flood Risk"], ["see_examples", "See Real Examples"], ["prepare_before_flooding", "Prepare Before Flooding"],
  ["protect_home", "Protect a Home"], ["protect_business", "Protect a Business"], ["respond_during_flooding", "Respond During Flooding"],
  ["recover_after_flooding", "Recover After Flooding"], ["get_financial_help", "Get Financial Help"], ["deal_with_landlord", "Deal With a Landlord"],
  ["maintain_business_operations", "Keep a Business Running"], ["learn_systems", "Learn How the Systems Work"],
];
export const labelFor = (list, key) => list.find(([k]) => k === key)?.[1] ?? key ?? "";

/** The sheet's columns (plus status and hazard_type), in order. CSV upload and download use these. */
export const SHEET_COLUMNS = ["ID", "status", "image_url", "image_type", "text", "fallback_text", "location", "flood_stage", "setting", "risk_level", "user_type", "home_type", "cost_tier", "use_case_tag", "trigger_keywords", "source_caption", "source_url", "hazard_type"];

const clean = (v) => String(v ?? "").trim();
const key = (v) => clean(v).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^\w]/g, "");
const split = (v) => clean(v).split(/\s*[,;|]\s*/).map((s) => s.trim()).filter(Boolean);
const uniq = (xs) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];
const pick = (list, v, aliases = {}) => {
  const k = key(v);
  return aliases[k] ?? list.find(([lk, label]) => lk === k || key(label) === k)?.[0] ?? null;
};
const https = (v) => { const s = clean(v); return s && !/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : s; };

const KIND_ALIASES = { illustration: "art", artwork: "art", risk_map: "map", infographic: "education", quote: "story", image: "photo", photograph: "photo" };
const STAGE_ALIASES = { pre_flood: "before", preflood: "before", during_flood: "during", post_flood: "after", postflood: "after", any: "general", any_time: "general", "": "general" };
const AUDIENCE_ALIASES = { everyone: "both", all: "both", general: "both", "": "both", renters: "renter", homeowner: "owner", homeowners: "owner", owners: "owner", small_businesses: "small_business", business: "small_business", businesses: "small_business" };
const BUILDING_ALIASES = { apartment_building: "apartment", apartments: "apartment", singe_family: "single_family", single_family_home: "single_family", house: "single_family", multifamily: "multi_family", multi_family_home: "multi_family", storefront: "small_business", business: "small_business" };
const BUILDING_SKIP = new Set(["general", "any", "none", "all", ""]);
const HAZARD_ALIASES = { rain: "stormwater", sewer: "stormwater", sewers: "stormwater", tidal: "coastal", tide: "coastal", storm_surge: "coastal", several: "combined", mixed: "combined" };
const PURPOSE_ALIASES = {
  awareness: "understand_risk", home_protection: "protect_home", landlord: "deal_with_landlord", protect_their_home: "protect_home",
  protect_their_business: "protect_business", story_about_damage_and_insurance: "see_examples", roads: "understand_risk", learn_about_systems: "learn_systems",
};

/** Sheet "location" text -> place names from nyc-places.json (unknown names are kept as written). */
export function placesFrom(text, places) {
  const t = clean(text);
  if (!t) return [];
  if (/^(all|citywide|nyc|new york city|all of nyc)$/i.test(t)) return ["New York City"];
  const byName = (s) => places.find((p) => p.name.toLowerCase() === s.toLowerCase() || p.label.toLowerCase() === s.toLowerCase() || (p.level === "city" && /^(all|citywide|nyc)$/i.test(s)));
  const out = [];
  for (const part of t.split(/\s*[|;]\s*/).filter(Boolean)) {
    const whole = byName(part);
    if (whole) { out.push(whole.name); continue; }
    for (const piece of part.split(/\s*,\s*/).filter(Boolean)) out.push(byName(piece)?.name ?? piece);
  }
  return uniq(out);
}

/**
 * One sheet/CSV row -> story fields for fc_save_stories, plus notes about
 * anything that didn't fit (it's kept as a tag rather than dropped).
 * Columns missing from the row are left out, so an upload only changes what it has.
 */
export function fromSheetRow(raw, places) {
  const has = (k) => Object.prototype.hasOwnProperty.call(raw, k);
  const notes = [];
  const f = {};
  const extraTags = [];
  if (clean(raw.ID)) {
    const n = Number(clean(raw.ID));
    Number.isInteger(n) && n > 0 ? (f.story_no = n) : notes.push(`ID “${raw.ID}” isn't a whole number, so this is added as a new story.`);
  }
  if (has("status") && clean(raw.status)) f.status = pick([["published"], ["draft"], ["hidden"]], raw.status) ?? (notes.push(`Unknown status “${raw.status}”.`), undefined);
  if (has("image_url") || has("imgur")) f.image_url = https(raw.image_url) || https(raw.imgur);
  if (has("image_type")) f.kind = pick(KINDS, raw.image_type, KIND_ALIASES) ?? (clean(raw.image_type) && notes.push(`Type “${raw.image_type}” isn't a known type; set to Photo.`), "photo");
  if (has("text")) f.text = clean(raw.text);
  if (has("fallback_text")) f.alt_text = clean(raw.fallback_text);
  if (has("location")) f.places = placesFrom(raw.location, places);
  if (has("flood_stage")) f.stage = pick(STAGES, raw.flood_stage, STAGE_ALIASES) ?? (notes.push(`When “${raw.flood_stage}” isn't known; set to Any Time.`), "general");
  if (has("setting")) f.setting = pick(SETTINGS, raw.setting, { inside_building: "inside" }) ?? "";
  if (has("risk_level")) f.risk_level = pick(LEVELS, raw.risk_level) ?? "";
  if (has("cost_tier")) f.cost_tier = pick(LEVELS, raw.cost_tier) ?? "";
  if (has("user_type")) f.audience = pick(AUDIENCES, raw.user_type, AUDIENCE_ALIASES) ?? (notes.push(`Who “${raw.user_type}” isn't known; set to Everyone.`), "both");
  if (has("hazard_type")) f.hazard_type = pick(HAZARDS, raw.hazard_type, HAZARD_ALIASES) ?? "";
  if (has("home_type")) {
    f.building_types = [];
    for (const b of split(clean(raw.home_type).replace(/_/g, " ").replace(/,\s*/g, ","))) {
      if (BUILDING_SKIP.has(key(b))) continue;
      const k = pick(BUILDINGS, b, BUILDING_ALIASES);
      k ? f.building_types.push(k) : extraTags.push(b.toLowerCase());
    }
    f.building_types = [...new Set(f.building_types)];
  }
  if (has("use_case_tag")) {
    f.purposes = [];
    for (const p of split(raw.use_case_tag)) {
      const k = pick(PURPOSES, p, PURPOSE_ALIASES);
      k ? f.purposes.push(k) : extraTags.push(p.toLowerCase());
    }
    f.purposes = [...new Set(f.purposes)];
  }
  if (has("trigger_keywords") || extraTags.length) f.tags = uniq([...split(raw.trigger_keywords), ...extraTags]);
  if (extraTags.length) notes.push(`Kept as tags: ${extraTags.join(", ")}.`);
  if (has("source_caption")) f.credit = clean(raw.source_caption);
  if (has("source_url")) f.source_url = https(raw.source_url);
  for (const u of ["image_url", "source_url"]) if (f[u] && !/^https?:\/\/\S+$/.test(f[u])) { notes.push(`${u === "image_url" ? "Image" : "Source"} link “${f[u]}” isn't a web address; left out.`); f[u] = ""; }
  return { fields: f, notes };
}

/** Story -> sheet/CSV row (round-trips through fromSheetRow). */
export function toSheetRow(s) {
  return {
    ID: s.story_no, status: s.status, image_url: s.image_url ?? "", image_type: s.kind, text: s.text, fallback_text: s.alt_text ?? "",
    location: (s.places ?? []).join(" | "), flood_stage: s.stage, setting: s.setting ?? "", risk_level: s.risk_level ?? "", user_type: s.audience,
    home_type: (s.building_types ?? []).join(", "), cost_tier: s.cost_tier ?? "", use_case_tag: (s.purposes ?? []).join(", "),
    trigger_keywords: (s.tags ?? []).join(", "), source_caption: s.credit ?? "", source_url: s.source_url ?? "", hazard_type: s.hazard_type ?? "",
  };
}

/** The repo JSON's shape (Flood Chat's old stories.json) -> sheet row. */
export function fromChatJson(r) {
  return {
    ID: r.id, image_url: r.image_url, image_type: r.content_type, text: r.text, fallback_text: r.fallback_text, location: r.location,
    flood_stage: r.stage, setting: r.setting, risk_level: r.risk_level, user_type: r.audience, home_type: r.asset_type, cost_tier: r.cost_tier,
    use_case_tag: r.intent, trigger_keywords: r.tags, source_caption: r.source_caption, source_url: r.source_url, hazard_type: r.hazard_type,
  };
}
