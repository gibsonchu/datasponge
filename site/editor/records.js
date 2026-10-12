/**
 * DataSponge 0.1 <-> flat rows, in the browser.
 *
 * Staff edit services (FSS) and answers & resources (FRS) as flat rows: one
 * form, or one CSV row. COLUMNS is the single source of truth for the form,
 * the CSV template, and the column guide. Records are validated here against
 * the DataSponge JSON Schemas (../standards) for friendly field errors; the
 * database validates them again on save.
 */
import Ajv2020 from "https://esm.sh/ajv@8.17.1/dist/2020?bundle";
import addFormats from "https://esm.sh/ajv-formats@3.0.1?bundle";

const load = (f) => fetch(new URL(`../standards/${f}`, import.meta.url)).then((r) => r.json());
const [TAXONOMY, FSS, FRS] = await Promise.all([load("taxonomy.json"), load("fss.schema.json"), load("frs.schema.json")]);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const VALIDATORS = { FSS: ajv.compile(FSS), FRS: ajv.compile(FRS) };

export const SCHEMA_VERSION = "0.1.0";
export const STATUSES = ["published", "draft", "hidden"];
export const AUDIENCES = ["public", "internal"];
export const PUBLISHER = { id: "https://github.com/gibsonchu/datasponge", name: "DataSponge" };

// Plain-language answers to "Taking new people?".
const AVAILABILITY_LABELS = {
  listed_contact_provider: "Yes — contact them to confirm",
  confirmed_available: "Yes — confirmed by the provider (add the date below)",
  request_subject_to_capacity: "Yes, if they have room",
  deadline_listed: "Yes, until the application deadline",
  expression_of_interest: "Sign-up or interest list only",
  event_dependent: "Only after a declared disaster or event",
  intake_unconfirmed: "Not sure — intake not confirmed",
  temporarily_unavailable: "Paused for now (hidden from Local Help)",
  closed: "Closed (hidden from Local Help)",
  historical: "No longer runs (hidden from Local Help)",
};
const cap = (k) => k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const terms = (dim) => TAXONOMY.filter((t) => t.dimension === dim).map((t) => ({ key: t.key, label: t.label }));
export const TERMS = {
  topic: terms("topic"),
  audience: terms("audience").sort((a, b) => a.label.localeCompare(b.label)),
  stage: terms("stage"),
  availability: terms("availability").map((t) => ({ ...t, label: AVAILABILITY_LABELS[t.key] ?? t.label })),
  evidence_status: ["website_documented", "index_only", "provider_confirmed", "unknown"].map((k) => ({ key: k, label: cap(k) })),
  verification_status: ["unreviewed", "source_checked", "reviewed", "disputed"].map((k) => ({ key: k, label: cap(k) })),
  status: [{ key: "published", label: "Published" }, { key: "draft", label: "Draft" }, { key: "hidden", label: "Hidden" }],
  visibility: [{ key: "public", label: "Public (Local Help and the AI)" }, { key: "internal", label: "AI-only (not shown on public pages)" }],
};

// Suggested service types (FSS service.type is free text; these keep Local Help's labels tidy).
export const SERVICE_TYPES = [
  "referral", "financial_help", "insurance_help", "legal_help", "tenant_support", "small_business_support", "emergency_response",
  "cleanup", "mold_remediation", "mold_assessment", "plumbing", "sewer_cleaning", "waterproofing", "backwater_valve", "sump_pump_install",
  "education", "workforce", "planning", "preparedness", "community", "advocacy", "green_infrastructure", "climate_resilience",
];
export const typeLabel = (k) => k.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const RESOURCE_TYPES = ["faq_answer", "guide", "report", "fact_sheet", "map", "dataset", "policy", "video", "toolkit"];

/**
 * key: CSV column / form field. fc: the DataSponge field it fills. std: which standards use it.
 * list: "|"-separated in CSV. terms: taxonomy dimension. def: default.
 */
export const COLUMNS = [
  { key: "id", std: ["FSS", "FRS"], group: "system", fc: "id", help: "DataSponge record id (urn:uuid:…). Leave blank for new records; keep it to update one." },
  { key: "local_id", std: ["FSS", "FRS"], group: "system", fc: "local_id", help: "Short id. Leave blank for new records; keep it to update one." },
  { key: "status", std: ["FSS", "FRS"], group: "visibility", terms: "status", def: "published", label: "Status", fc: "(DataSponge status)", help: "Published is live. Draft is a work in progress. Hidden takes it offline. Only editors can publish." },
  { key: "audience", std: ["FSS", "FRS"], group: "visibility", terms: "visibility", def: "public", label: "Who Can See It", fc: "(DataSponge audience)", help: "Public shows it on Local Help and to the AI. AI-only keeps it off public pages." },
  { key: "title", std: ["FSS", "FRS"], group: "basics", required: true, label: { FSS: "Service Name", FRS: "Title or Question" }, fc: "title", help: "" },
  { key: "summary", std: ["FSS", "FRS"], group: "basics", required: true, long: true, label: { FSS: "What They Do", FRS: "Summary or Answer" }, fc: "summary", help: "" },
  { key: "provider_name", std: ["FSS"], group: "basics", label: "Provider (Organization)", fc: "service.provider.name", help: "Defaults to the service name." },
  { key: "service_type", std: ["FSS"], group: "basics", required: true, suggest: SERVICE_TYPES, label: "Service Type", fc: "service.type", help: "" },
  { key: "resource_type", std: ["FRS"], group: "basics", def: "faq_answer", suggest: RESOURCE_TYPES, label: "Resource Type", fc: "resource.type", help: "faq_answer shows as a quick answer on Local Help. Use guide, report, etc. for documents." },
  { key: "service_area", std: ["FSS"], group: "where", required: true, label: "Service Area", fc: "service.service_area", help: "Tick NYC Citywide, whole boroughs, or specific neighborhoods. Local Help's borough filter uses these." },
  { key: "places", std: ["FSS", "FRS"], group: "where", list: true, label: "Places", fc: "places[].name", help: "Separate with |. Defaults to the service area (services) or “New York City”." },
  { key: "categories", std: ["FSS", "FRS"], group: "who", required: true, list: true, terms: "topic", label: "Topics", fc: "categories", help: "Topic keys or labels, separated by |." },
  { key: "audiences", std: ["FSS", "FRS"], group: "who", list: true, terms: "audience", def: "residents", label: "Who It's For", fc: "audiences", help: "e.g. residents | renters | homeowners | businesses" },
  { key: "action_stages", std: ["FSS", "FRS"], group: "who", list: true, terms: "stage", label: "When", fc: "action_stages", help: "understand | prepare | respond | recover | adapt" },
  { key: "tags", std: ["FSS", "FRS"], group: "who", list: true, label: "Other Tags", fc: "tags", help: "Other words people might search for, like a nickname, program name, or “sump pump”. Press Enter after each." },
  { key: "phone", std: ["FSS"], group: "contact", label: "Phone", fc: "service.phone", help: "" },
  { key: "email", std: ["FSS"], group: "contact", label: "Email", fc: "service.email", help: "" },
  { key: "contact_url", std: ["FSS"], group: "contact", label: "Website / Intake Link", fc: "service.contact_url", help: "https://…" },
  { key: "provider_url", std: ["FSS"], group: "contact", label: "Provider Homepage", fc: "service.provider.id", help: "Defaults to the website." },
  { key: "availability", std: ["FSS"], group: "details", terms: "availability", def: "listed_contact_provider", label: "Taking New People?", fc: "service.availability", help: "Whether they're accepting people right now. Paused, closed, and no-longer-running services are hidden from Local Help." },
  { key: "availability_note", std: ["FSS"], group: "details", label: "Availability Details", fc: "service.availability_note", help: "Optional, e.g. “Waitlist until March”." },
  { key: "eligibility", std: ["FSS"], group: "details", long: true, label: "Who Qualifies", fc: "service.eligibility", help: "Who can get this help, e.g. \u201cHomeowners in Brooklyn\u201d or \u201cHousehold income under 80% AMI\u201d. Leave blank if anyone can." },
  { key: "cost", std: ["FSS"], group: "details", label: "Cost", fc: "service.cost", help: "" },
  { key: "hours", std: ["FSS"], group: "details", label: "Hours of Operation", fc: "service.hours", help: "" },
  { key: "deadline", std: ["FSS"], group: "details", date: true, label: "Application Deadline", fc: "service.deadline", help: "Last day to apply, for time-limited programs like post-storm grants. Local Help hides the listing after this date." },
  { key: "service_languages", std: ["FSS"], group: "details", list: true, label: "Languages Spoken", fc: "service.languages", help: "Press Enter after each language." },
  { key: "accessibility", std: ["FSS"], group: "details", label: "Accessibility", fc: "service.accessibility", help: "" },
  { key: "languages", advanced: true, std: ["FSS", "FRS"], group: "source", list: true, def: "en", label: "Record Language", fc: "languages", help: "Language codes of this record's text, e.g. en | es." },
  { key: "document_url", std: ["FRS"], group: "source", label: "Document or Read-More Link", fc: "resource.document_url", help: "Link to the PDF, page, or document. Defaults to the source link." },
  { key: "publication_date", std: ["FRS"], group: "source", date: true, label: "Published On", fc: "resource.publication_date", help: "YYYY-MM-DD" },
  { key: "source_url", std: ["FSS", "FRS"], group: "source", required: true, label: "Source Link", fc: "source.url", help: "Where this information came from. Filled from the website if you leave it blank." },
  { key: "source_organization", advanced: true, std: ["FSS", "FRS"], group: "source", label: "Source Organization", fc: "source.organization", help: "Filled from the provider if you leave it blank." },
  { key: "source_checked_at", advanced: true, std: ["FSS", "FRS"], group: "source", date: true, label: "Source Checked On", fc: "source.checked_at", help: "YYYY-MM-DD" },
  { key: "evidence_status", advanced: true, std: ["FSS", "FRS"], group: "source", terms: "evidence_status", def: "website_documented", label: "Evidence", fc: "source.evidence_status", help: "index_only records can't be published." },
  { key: "provider_confirmed_at", advanced: true, std: ["FSS"], group: "source", date: true, label: "Provider Confirmed On", fc: "service.provider_confirmed_at", help: "Needed to mark a service confirmed available." },
  { key: "review_due", std: ["FSS"], group: "source", date: true, label: "Review Again By", fc: "service.review_due", help: "Defaults to six months from today. Must be in the future to publish." },
  { key: "verification_status", std: ["FSS", "FRS"], group: "source", terms: "verification_status", def: "unreviewed", label: "Review Status", fc: "verification.status", help: "Only mark reviewed when someone has actually checked it." },
  { key: "verified_at", advanced: true, std: ["FSS", "FRS"], group: "source", date: true, label: "Reviewed On", fc: "verification.verified_at", help: "YYYY-MM-DD" },
];
export const columnsFor = (std) => COLUMNS.filter((c) => c.std.includes(std));
export const labelOf = (c, std) => (typeof c.label === "object" ? c.label[std] : c.label) || c.key;

const clean = (v) => (v == null ? "" : String(v).trim());
const nul = (v) => clean(v) || null;
// Free-text lists use "|" (names can contain ; or ,). Taxonomy lists also accept ; and , since keys never contain them.
const list = (v, loose = false) => [...new Set(clean(v).split(loose ? /\s*[|;,\n]\s*/ : /\s*[|\n]\s*/).map((s) => s.trim()).filter(Boolean))];
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 80) || "place";
const httpsish = (v) => { const s = clean(v); return s && !/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : s; };
export const today = () => new Date().toISOString().slice(0, 10);
export const sixMonths = () => { const d = new Date(); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 10); };

// Accept a term's key or label ("Financial assistance" -> financial_assistance).
function normTerms(values, dim) {
  return values.map((v) => {
    const k = v.toLowerCase().replace(/[\s-]+/g, "_");
    return TERMS[dim].find((t) => t.key === k || t.label.toLowerCase() === v.toLowerCase())?.key ?? v;
  });
}
export function normChoice(value, dim) {
  const v = clean(value);
  if (!v) return "";
  if (dim === "visibility" && /^(ai|ai[-_ ]only|internal|private)$/i.test(v)) return "internal";
  return normTerms([v], dim)[0].toLowerCase();
}

export function newIds(std) {
  const uuid = crypto.randomUUID();
  return { id: `urn:uuid:${uuid}`, local_id: `fc-${std.toLowerCase()}-${uuid.slice(0, 8)}` };
}

/** Flat row (+ the existing record, when updating) -> DataSponge record. */
export function fromRow(std, row, existing = null, now = new Date().toISOString()) {
  const v = (k) => clean(row[k]) || clean(COLUMNS.find((c) => c.key === k)?.def);
  const L = (k) => list(v(k));
  const T = (k, dim) => normTerms(list(v(k), true), dim);
  const title = v("title");
  const ids = existing ? { id: existing.id, local_id: existing.local_id } : { ...newIds(std), ...(v("id") && { id: v("id") }), ...(v("local_id") && { local_id: v("local_id") }) };
  const serviceArea = v("service_area");
  const placeNames = L("places").length ? L("places") : std === "FSS" ? (serviceArea ? [serviceArea] : []) : ["New York City"];
  const oldPlaces = new Map((existing?.places ?? []).map((p) => [p.name, p]));
  const provider = v("provider_name") || title;
  const sourceUrl = httpsish(v("source_url"));

  const record = {
    ...ids,
    standard: std,
    schema_version: SCHEMA_VERSION,
    publisher: existing?.publisher ?? PUBLISHER,
    title,
    summary: v("summary"),
    categories: T("categories", "topic"),
    tags: L("tags"),
    action_stages: T("action_stages", "stage"),
    audiences: T("audiences", "audience"),
    languages: L("languages"),
    places: placeNames.map((name) => oldPlaces.get(name) ?? { id: slug(name), name, relation: std === "FSS" ? "serves" : "covers", precision: "named_area", geometry: null }),
    event: existing?.event ?? null,
    source: { url: sourceUrl, organization: v("source_organization") || provider, checked_at: nul(v("source_checked_at")), evidence_status: v("evidence_status") },
    rights: existing?.rights ?? { status: "not_assessed", license: null, license_url: null, attribution: null },
    verification: { status: v("verification_status"), method: existing?.verification?.method ?? null, verified_at: nul(v("verified_at")) },
    relationships: existing?.relationships ?? [],
    metadata: { created_at: existing?.metadata?.created_at ?? now, updated_at: now, record_version: (existing?.metadata?.record_version ?? 0) + 1 },
  };
  if (std === "FSS") {
    const contact = httpsish(v("contact_url"));
    record.service = {
      provider: { id: httpsish(v("provider_url")) || contact || sourceUrl, name: provider },
      type: v("service_type").toLowerCase().replace(/[\s-]+/g, "_"),
      service_area: nul(serviceArea),
      eligibility: nul(v("eligibility")),
      availability: T("availability", "availability")[0] ?? "",
      // Optional in FSS 0.1: only written when there is a note or the record had the field.
      ...(v("availability_note") || (existing?.service && "availability_note" in existing.service) ? { availability_note: nul(v("availability_note")) } : {}),
      contact_url: nul(contact),
      phone: nul(v("phone")),
      email: nul(v("email")),
      cost: nul(v("cost")),
      hours: nul(v("hours")),
      deadline: nul(v("deadline")),
      languages: L("service_languages"),
      accessibility: nul(v("accessibility")),
      provider_confirmed_at: nul(v("provider_confirmed_at")),
      review_due: nul(v("review_due")) || sixMonths(),
    };
  } else {
    record.resource = {
      type: v("resource_type"),
      publication_date: nul(v("publication_date")),
      publication_date_text: existing?.resource?.publication_date_text ?? null,
      evidence_kind: existing?.resource?.evidence_kind ?? null,
      document_url: httpsish(v("document_url")) || sourceUrl,
    };
  }
  return record;
}

/**
 * Apply a row to an existing record. Columns the row leaves out, and cells
 * left blank, keep their current values. Type CLEAR in a cell to erase it.
 */
export const CLEAR = "CLEAR";
export function applyRow(std, row, existing, meta = {}) {
  const cleared = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clean(v).toUpperCase() === CLEAR ? "" : v]));
  if (!existing) return fromRow(std, cleared(row));
  const present = cleared(Object.fromEntries(Object.entries(row).filter(([k, v]) => COLUMNS.some((c) => c.key === k) && clean(v) !== "")));
  return fromRow(std, { ...toRow(existing, meta), ...present }, existing);
}

/** DataSponge record -> flat row (for editing and CSV export). */
export function toRow(r, { status = "published", audience = "public" } = {}) {
  const s = r.service ?? {};
  const row = {
    id: r.id, local_id: r.local_id, status, audience,
    title: r.title, summary: r.summary,
    provider_name: s.provider?.name, service_type: s.type, service_area: s.service_area,
    places: r.places.map((p) => p.name).join(" | "),
    categories: r.categories.join(" | "), audiences: r.audiences.join(" | "), action_stages: r.action_stages.join(" | "),
    phone: s.phone, email: s.email, contact_url: s.contact_url, provider_url: s.provider?.id,
    availability: s.availability, availability_note: s.availability_note, eligibility: s.eligibility, cost: s.cost, hours: s.hours, deadline: s.deadline,
    service_languages: (s.languages ?? []).join(" | "), accessibility: s.accessibility,
    resource_type: r.resource?.type, document_url: r.resource?.document_url, publication_date: r.resource?.publication_date,
    source_url: r.source.url, source_organization: r.source.organization, source_checked_at: r.source.checked_at,
    evidence_status: r.source.evidence_status, provider_confirmed_at: s.provider_confirmed_at, review_due: s.review_due,
    verification_status: r.verification.status, verified_at: r.verification.verified_at,
    tags: r.tags.join(" | "), languages: r.languages.join(" | "),
  };
  return Object.fromEntries(columnsFor(r.standard).map((c) => [c.key, row[c.key] ?? ""]));
}

// JSON-pointer path in the record -> the column staff typed it in.
const PATH_TO_COLUMN = [
  [/^\/title/, "title"], [/^\/summary/, "summary"], [/^\/categories/, "categories"], [/^\/audiences/, "audiences"],
  [/^\/action_stages/, "action_stages"], [/^\/places/, "places"], [/^\/tags/, "tags"], [/^\/languages/, "languages"],
  [/^\/id/, "id"], [/^\/source\/url/, "source_url"], [/^\/source\/checked_at/, "source_checked_at"], [/^\/source\/evidence_status/, "evidence_status"],
  [/^\/verification\/status/, "verification_status"], [/^\/verification\/verified_at/, "verified_at"],
  [/^\/service\/provider\/id/, "provider_url"], [/^\/service\/type/, "service_type"], [/^\/service\/contact_url/, "contact_url"],
  [/^\/service\/availability/, "availability"], [/^\/service\/deadline/, "deadline"], [/^\/service\/provider_confirmed_at/, "provider_confirmed_at"],
  [/^\/service\/review_due/, "review_due"], [/^\/resource\/document_url/, "document_url"], [/^\/resource\/publication_date/, "publication_date"],
  [/^\/resource\/type/, "resource_type"],
];
const FRIENDLY = { format: (e) => (e.params.format === "date" ? "use YYYY-MM-DD" : "must be a full link starting with https://"), pattern: () => "must be a full link starting with https://", minLength: () => "is required", enum: () => "isn't one of the allowed values" };

/** -> { field: message } (empty when valid). `status` is the target status. */
export function validate(record, status = "draft") {
  const errors = {};
  const add = (k, m) => { if (!errors[k]) errors[k] = m; };
  for (const c of columnsFor(record.standard)) if (c.required) {
    const val = { title: record.title, summary: record.summary, categories: record.categories.length, source_url: record.source.url, service_type: record.service?.type, service_area: record.service?.service_area }[c.key];
    if (!val) add(c.key, "is required");
  }
  const check = (key, values, dim) => {
    const bad = values.filter((x) => !TERMS[dim].some((t) => t.key === x));
    if (bad.length) add(key, `unknown: ${bad.join(", ")}`);
  };
  check("categories", record.categories, "topic");
  check("audiences", record.audiences, "audience");
  check("action_stages", record.action_stages, "stage");
  if (record.service) check("availability", [record.service.availability], "availability");
  if (record.service?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.service.email)) add("email", "doesn't look like an email address");
  // Rules the database applies when publishing, checked early so staff see them on the right field.
  if (status === "published") {
    if (record.source.evidence_status === "index_only") add("evidence_status", "index_only records can't be published; check the full source first");
    if (record.service && record.service.review_due && record.service.review_due < today()) add("review_due", "must be a future date to publish");
    if (record.service?.availability === "confirmed_available" && !record.service.provider_confirmed_at) add("provider_confirmed_at", "is needed to mark a service confirmed available");
  }
  const v = VALIDATORS[record.standard];
  if (!v(record)) for (const e of v.errors) {
    let col = PATH_TO_COLUMN.find(([re]) => re.test(e.instancePath))?.[1] ?? "record";
    if (col === "provider_url" && record.service.provider.id === record.source.url) col = "source_url";
    add(col, FRIENDLY[e.keyword]?.(e) ?? e.message);
  }
  return errors;
}

/** Current help: mirrors isCurrent() on Local Help. */
export function isCurrent(r, day = today()) {
  const s = r.service;
  if (!s) return true;
  return !["closed", "historical", "temporarily_unavailable"].includes(s.availability) && (!s.deadline || s.deadline >= day);
}

// Key order differs between publishers, so compare with sorted keys; ignore metadata.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const sameRecord = (a, b) => JSON.stringify(canon({ ...a, metadata: null })) === JSON.stringify(canon({ ...b, metadata: null }));
