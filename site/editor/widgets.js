/**
 * Structured pickers for the service form. FSS stores service area, places,
 * hours, cost, and type as text, so each picker reads and writes plain text
 * that Local Help and the AI already understand:
 *
 *   service_area  "Citywide" | "Red Hook, Brooklyn; Queens"
 *   places        "New York City" | "Red Hook, Brooklyn | Queens"
 *   hours         "Open 24/7" | "Mon–Fri 9 AM–5 PM; Sat 10 AM–2 PM"
 *   cost          "Free" | "$$–$$$"
 *
 * A picker the editor never touches keeps the record's original text, so
 * older listings with free-form values aren't rewritten by accident.
 */
import { typeLabel } from "./records.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const PLACES = await fetch(new URL("./nyc-places.json", import.meta.url)).then((r) => r.json());
const byId = new Map(PLACES.map((p) => [p.id, p]));
const byName = new Map(PLACES.map((p) => [p.name.toLowerCase(), p]));
const touched = (el) => el?.dataset.dirty === "1";
export function markDirty(e) {
  const w = e.target.closest("[data-widget]");
  if (w) w.dataset.dirty = "1";
}

// ---------- service type ----------
export const SERVICE_TYPE_KEYS = [
  "referral", "financial_help", "insurance_help", "legal_help", "tenant_support", "small_business_support", "emergency_response",
  "cleanup", "mold_remediation", "mold_assessment", "plumbing", "sewer_cleaning", "waterproofing", "backwater_valve", "sump_pump_install",
  "education", "workforce", "planning", "preparedness", "community", "advocacy", "green_infrastructure", "climate_resilience",
];
export function serviceTypeHtml(value) {
  const known = SERVICE_TYPE_KEYS.includes(value);
  const other = value && !known;
  return `<div class="type-pick" data-widget="type">
    <select id="f-service_type" name="service_type">
      <option value="" ${value ? "" : "selected"}>Choose a type…</option>
      ${[...SERVICE_TYPE_KEYS].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b))).map((k) => `<option value="${k}" ${value === k ? "selected" : ""}>${esc(typeLabel(k))}</option>`).join("")}
      <option value="other" ${other ? "selected" : ""}>Other…</option>
    </select>
    <input name="service_type_other" placeholder="Describe the type, e.g. Roof repair" value="${other ? esc(typeLabel(value)) : ""}" ${other ? "" : "hidden"} aria-label="Other service type">
  </div>`;
}
export function readServiceType(form) {
  const v = form.elements.service_type.value;
  return v === "other" ? form.elements.service_type_other.value.trim() : v;
}
export function setServiceType(form, type, other) {
  const sel = form.elements.service_type;
  const box = form.elements.service_type_other;
  if (SERVICE_TYPE_KEYS.includes(type)) { sel.value = type; box.hidden = true; }
  else { sel.value = "other"; box.hidden = false; box.value = other || (type && type !== "other" ? typeLabel(type) : ""); }
}

// ---------- service area (area + places) ----------
// Original values are kept on the element so an untouched picker saves them unchanged.
export function areaHtml(serviceArea, places) {
  const names = String(places ?? "").split(/\s*\|\s*/).filter(Boolean);
  const picked = new Set();
  const extra = [];
  for (const n of names) {
    const p = byName.get(n.toLowerCase());
    p ? picked.add(p.id) : extra.push(n);
  }
  if (/\bcitywide\b|^new york city$|^nyc$/i.test(serviceArea ?? "")) picked.add("citywide");
  const box = (p) => `<label><input type="checkbox" name="area" value="${p.id}" ${picked.has(p.id) ? "checked" : ""}>${esc(p.label)}</label>`;
  const boroughs = PLACES.filter((p) => p.level === "borough");
  return `<div class="area-pick" data-widget="area" data-orig-area="${esc(serviceArea ?? "")}" data-orig-places="${esc(places ?? "")}">
    <div class="checks">${box(byId.get("citywide"))}</div>
    <p class="pick-head">Boroughs</p>
    <div class="checks">${boroughs.map(box).join("")}</div>
    <details class="hoods" ${PLACES.some((p) => p.level === "neighborhood" && picked.has(p.id)) ? "open" : ""}>
      <summary>Neighborhoods</summary>
      ${boroughs.map((b) => `<p class="pick-head">${esc(b.label)}</p><div class="checks">${PLACES.filter((p) => p.borough === b.label).map(box).join("")}</div>`).join("")}
    </details>
    ${extra.length ? `<p class="pick-head">Also listed (from the existing record)</p><div class="checks">${extra.map((n) => `<label><input type="checkbox" name="area_extra" value="${esc(n)}" checked>${esc(n)}</label>`).join("")}</div>` : ""}
    ${serviceArea && serviceArea !== areaText(picked, extra) ? `<p class="hint">Current description: “${esc(serviceArea)}”. It stays as written unless you change the boxes.</p>` : ""}
  </div>`;
}
const areaText = (ids, extra = []) => ([...ids].includes("citywide") ? "Citywide" : [...[...ids].map((id) => byId.get(id).name), ...extra].join("; "));
export function readArea(form) {
  const w = form.querySelector('[data-widget="area"]');
  if (!touched(w)) return { service_area: w.dataset.origArea, places: w.dataset.origPlaces };
  const ids = [...form.querySelectorAll('input[name="area"]:checked')].map((i) => i.value);
  const extra = [...form.querySelectorAll('input[name="area_extra"]:checked')].map((i) => i.value);
  if (ids.includes("citywide")) return { service_area: "Citywide", places: ["New York City", ...extra].join(" | ") };
  return { service_area: areaText(ids, extra), places: [...ids.map((id) => byId.get(id).name), ...extra].join(" | ") };
}
export function setAreas(form, ids) {
  const w = form.querySelector('[data-widget="area"]');
  for (const i of form.querySelectorAll('input[name="area"]')) i.checked = ids.includes(i.value);
  if (ids.some((id) => byId.get(id)?.level === "neighborhood")) w.querySelector("details.hoods").open = true;
  w.dataset.dirty = "1";
}

// ---------- hours ----------
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const fmtTime = (t) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
const parseTime = (s) => {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
};
// "Mon–Fri 9 AM–5 PM; Sat 10 AM–2 PM" -> { mon: ["09:00","17:00"], ... }, or null if it isn't this format.
function parseHours(text) {
  const out = {};
  for (const part of String(text).split(/\s*;\s*/)) {
    const m = part.match(/^(\w{3})(?:–(\w{3}))?\s+(.+?)–(.+)$/);
    if (!m) return null;
    const a = DAYS.findIndex(([, l]) => l === m[1]);
    const b = m[2] ? DAYS.findIndex(([, l]) => l === m[2]) : a;
    const open = parseTime(m[3]);
    const close = parseTime(m[4]);
    if (a < 0 || b < a || !open || !close) return null;
    for (let i = a; i <= b; i++) out[DAYS[i][0]] = [open, close];
  }
  return out;
}
export function formatHours(days) {
  const parts = [];
  let i = 0;
  while (i < DAYS.length) {
    const d = days[DAYS[i][0]];
    if (!d) { i++; continue; }
    let j = i;
    while (j + 1 < DAYS.length && days[DAYS[j + 1][0]]?.join() === d.join()) j++;
    parts.push(`${DAYS[i][1]}${j > i ? `–${DAYS[j][1]}` : ""} ${fmtTime(d[0])}–${fmtTime(d[1])}`);
    i = j + 1;
  }
  return parts.join("; ");
}
export function hoursHtml(value) {
  const always = /^open 24\/7$/i.test(value ?? "");
  const days = (!always && value && parseHours(value)) || {};
  const custom = value && !always && !Object.keys(days).length;
  return `<div class="hours-pick" data-widget="hours" data-orig="${esc(value ?? "")}">
    <div class="hours-top"><label class="inline-check"><input type="checkbox" name="hours_247" ${always ? "checked" : ""}> Open 24 hours, 7 days a week</label>
      <button type="button" class="btn small" data-copy-weekdays ${always ? "hidden" : ""}>Copy Monday's hours to Tue–Fri</button></div>
    <div class="days" ${always ? "hidden" : ""}>
      ${DAYS.map(([k, l]) => `<div class="day-row"><label class="inline-check"><input type="checkbox" name="day_${k}" ${days[k] ? "checked" : ""}> ${l}</label>
        <input type="time" name="open_${k}" value="${days[k]?.[0] ?? "09:00"}" aria-label="${l} opens" ${days[k] ? "" : "disabled"}>
        <span>to</span>
        <input type="time" name="close_${k}" value="${days[k]?.[1] ?? "17:00"}" aria-label="${l} closes" ${days[k] ? "" : "disabled"}></div>`).join("")}
    </div>
    ${custom ? `<p class="hint">Current hours: “${esc(value)}”. They stay as written unless you change the boxes.</p>` : ""}
  </div>`;
}
export function readHours(form) {
  const w = form.querySelector('[data-widget="hours"]');
  if (!touched(w)) return w.dataset.orig;
  if (form.elements.hours_247.checked) return "Open 24/7";
  const days = {};
  for (const [k] of DAYS) if (form.elements[`day_${k}`].checked) days[k] = [form.elements[`open_${k}`].value, form.elements[`close_${k}`].value];
  return formatHours(days);
}
export function setHours(form, open247, list) {
  const w = form.querySelector('[data-widget="hours"]');
  form.elements.hours_247.checked = Boolean(open247);
  w.querySelector(".days").hidden = Boolean(open247);
  w.querySelector("[data-copy-weekdays]").hidden = Boolean(open247);
  for (const [k] of DAYS) {
    const d = list?.find((x) => x.day === k);
    form.elements[`day_${k}`].checked = Boolean(d);
    form.elements[`open_${k}`].disabled = form.elements[`close_${k}`].disabled = !d;
    if (d) { form.elements[`open_${k}`].value = d.open; form.elements[`close_${k}`].value = d.close; }
  }
  w.dataset.dirty = "1";
}
export function hoursEvents(e) {
  const form = e.target.form;
  if (!form) return;
  if (e.target.name === "hours_247") {
    form.querySelector('[data-widget="hours"] .days').hidden = e.target.checked;
    form.querySelector("[data-copy-weekdays]").hidden = e.target.checked;
  }
  const m = e.target.name?.match(/^day_(\w+)$/);
  if (m) form.elements[`open_${m[1]}`].disabled = form.elements[`close_${m[1]}`].disabled = !e.target.checked;
  if (e.target.name === "service_type") form.elements.service_type_other.hidden = e.target.value !== "other";
}
export function copyWeekdays(form) {
  const [o, c, on] = [form.elements.open_mon.value, form.elements.close_mon.value, form.elements.day_mon.checked];
  for (const k of ["tue", "wed", "thu", "fri"]) {
    form.elements[`day_${k}`].checked = on;
    form.elements[`open_${k}`].value = o;
    form.elements[`close_${k}`].value = c;
    form.elements[`open_${k}`].disabled = form.elements[`close_${k}`].disabled = !on;
  }
  form.querySelector('[data-widget="hours"]').dataset.dirty = "1";
}

// ---------- cost ----------
export const COST_LEVELS = [
  ["free", "Free", "Free"],
  ["1", "$", "$ — under $100"],
  ["2", "$$", "$$ — $100 to $500"],
  ["3", "$$$", "$$$ — $500 to $2,000"],
  ["4", "$$$$", "$$$$ — $2,000 to $10,000"],
  ["5", "$$$$$", "$$$$$ — over $10,000"],
];
const costKey = (sym) => COST_LEVELS.find(([, s]) => s === sym)?.[0];
function parseCost(text) {
  const parts = String(text ?? "").trim().split(/\s*–\s*/);
  const keys = parts.map(costKey);
  return keys.every(Boolean) && keys.length <= 2 ? [keys[0], keys[1] ?? keys[0]] : null;
}
export function costHtml(value) {
  const parsed = parseCost(value);
  const [lo, hi] = parsed ?? ["", ""];
  const opts = (sel) => `<option value="">Not sure</option>${COST_LEVELS.map(([k, , l]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
  return `<div class="cost-pick" data-widget="cost" data-orig="${esc(value ?? "")}">
    <label class="inline">From <select name="cost_min" aria-label="Lowest cost">${opts(lo)}</select></label>
    <label class="inline">To <select name="cost_max" aria-label="Highest cost">${opts(hi)}</select></label>
    ${value && !parsed ? `<p class="hint">Current cost: “${esc(value)}”. It stays as written unless you change the range.</p>` : ""}
  </div>`;
}
export function readCost(form) {
  const w = form.querySelector('[data-widget="cost"]');
  if (!touched(w)) return w.dataset.orig;
  let lo = form.elements.cost_min.value;
  let hi = form.elements.cost_max.value || lo;
  lo = lo || hi;
  if (!lo) return "";
  const rank = (k) => COST_LEVELS.findIndex(([x]) => x === k);
  if (rank(lo) > rank(hi)) [lo, hi] = [hi, lo];
  const sym = (k) => COST_LEVELS[rank(k)][1];
  return lo === hi ? sym(lo) : `${sym(lo)}–${sym(hi)}`;
}
export function setCost(form, lo, hi) {
  if (!lo || lo === "unknown") return false;
  form.elements.cost_min.value = lo;
  form.elements.cost_max.value = hi && hi !== "unknown" ? hi : lo;
  form.querySelector('[data-widget="cost"]').dataset.dirty = "1";
  return true;
}

// ---------- topics: grouped like Local Help's "I need help with" ----------
export const TOPIC_GROUPS = [
  ["Money & Insurance", ["business_recovery", "financial_assistance", "insurance"]],
  ["Your Home & Building", ["building_protection", "cleanup", "drainage", "health", "housing", "relocation"]],
  ["Recovery & Support", ["legal_assistance", "recovery", "referrals", "reporting", "shelter", "supplies"]],
  ["Getting Ready", ["alerts", "planning", "preparedness", "risk_mapping", "training"]],
  ["Community & Public Spaces", ["community_organizing", "infrastructure", "monitoring", "observed_impacts", "public_space", "transportation"]],
];
export function topicsHtml(terms, value) {
  const chosen = new Set(String(value ?? "").split(/\s*[|;,]\s*/).filter(Boolean));
  const label = new Map(terms.map((t) => [t.key, t.label]));
  const grouped = new Set(TOPIC_GROUPS.flatMap(([, ks]) => ks));
  const groups = [...TOPIC_GROUPS, ["Other", terms.map((t) => t.key).filter((k) => !grouped.has(k))]].filter(([, ks]) => ks.length);
  // Pick the kinds of help first; each one opens its specific topics.
  return `<div class="topic-groups">${groups
    .map(([g, ks], i) => {
      const open = ks.some((k) => chosen.has(k));
      return `<div class="topic-group"><label class="group-check"><input type="checkbox" name="topic_group" value="${i}" ${open ? "checked" : ""}>${esc(g)}</label>
        <div class="checks sub-topics" data-topic-group="${i}" ${open ? "" : "hidden"}>${[...ks]
          .sort((a, b) => (label.get(a) ?? a).localeCompare(label.get(b) ?? b))
          .map((k) => `<label><input type="checkbox" name="categories" value="${k}" ${chosen.has(k) ? "checked" : ""}>${esc(label.get(k) ?? k)}</label>`)
          .join("")}</div></div>`;
    })
    .join("")}</div>`;
}
export function topicGroupEvents(e) {
  if (e.target.name !== "topic_group") return;
  const box = e.target.closest(".topic-group").querySelector(".sub-topics");
  box.hidden = !e.target.checked;
  if (!e.target.checked) for (const c of box.querySelectorAll("input")) c.checked = false;
}
// After topics are ticked in code (web search), open their groups.
export function syncTopicGroups(form) {
  for (const g of form.querySelectorAll(".topic-group")) {
    const any = [...g.querySelectorAll('input[name="categories"]')].some((c) => c.checked);
    g.querySelector('input[name="topic_group"]').checked = any;
    g.querySelector(".sub-topics").hidden = !any;
  }
}

// ---------- when: before / during / after the flood ----------
const PHASES = [["before", "Before a flood", ["prepare", "understand", "adapt"]], ["during", "During a flood", ["respond"]], ["after", "After a flood", ["recover"]]];
export function stagesHtml(value) {
  const have = String(value ?? "").split(/\s*\|\s*/).filter(Boolean);
  return `<div class="checks" data-widget="stages" data-orig="${esc(value ?? "")}">${PHASES.map(([k, l, stages]) => `<label><input type="checkbox" name="phase" value="${k}" ${stages.some((s) => have.includes(s)) ? "checked" : ""}>${l}</label>`).join("")}</div>`;
}
export function readStages(form) {
  const w = form.querySelector('[data-widget="stages"]');
  if (!touched(w)) return w.dataset.orig;
  const have = w.dataset.orig.split(/\s*\|\s*/).filter(Boolean);
  const out = [];
  for (const [k, , stages] of PHASES) {
    if (!form.querySelector(`input[name="phase"][value="${k}"]`).checked) continue;
    const kept = stages.filter((s) => have.includes(s));
    out.push(...(kept.length ? kept : [stages[0]]));
  }
  return out.join(" | ");
}
export function setStages(form, stages) {
  for (const [k, , ss] of PHASES) form.querySelector(`input[name="phase"][value="${k}"]`).checked = ss.some((s) => stages.includes(s));
  form.querySelector('[data-widget="stages"]').dataset.dirty = "1";
}

// ---------- chips: type, press Enter, remove with × ----------
export function chipsHtml(name, value, placeholder) {
  const items = String(value ?? "").split(/\s*\|\s*/).filter(Boolean);
  return `<div class="chips-input" data-chips="${name}">
    <input type="hidden" name="${name}" value="${esc(items.join(" | "))}">
    <span class="chip-list">${items.map(chip).join("")}</span>
    <input class="chip-entry" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
  </div>`;
}
const chip = (t) => `<span class="chip" data-value="${esc(t)}">${esc(t)}<button type="button" aria-label="Remove ${esc(t)}">×</button></span>`;
function syncChips(box) {
  box.querySelector('input[type="hidden"]').value = [...box.querySelectorAll(".chip")].map((c) => c.dataset.value).join(" | ");
}
export function addChip(box, text) {
  const t = text.trim().replace(/\s*\|\s*/g, " ");
  if (!t || [...box.querySelectorAll(".chip")].some((c) => c.dataset.value.toLowerCase() === t.toLowerCase())) return;
  box.querySelector(".chip-list").insertAdjacentHTML("beforeend", chip(t));
  syncChips(box);
}
export function setChips(form, name, items) {
  const box = form.querySelector(`[data-chips="${name}"]`);
  box.querySelector(".chip-list").innerHTML = "";
  for (const t of items) addChip(box, t);
}
export function chipEvents(e) {
  const box = e.target.closest("[data-chips]");
  if (!box) return;
  if (e.type === "click" && e.target.closest(".chip button")) {
    e.target.closest(".chip").remove();
    syncChips(box);
    box.closest(".field")?.classList.remove("ai-filled");
  }
  if (e.type === "keydown" && e.target.classList.contains("chip-entry") && (e.key === "Enter" || e.key === ",")) {
    e.preventDefault();
    addChip(box, e.target.value);
    e.target.value = "";
  }
  if (e.type === "focusout" && e.target.classList.contains("chip-entry") && e.target.value.trim()) {
    addChip(box, e.target.value);
    e.target.value = "";
  }
}

// ---------- taking new people? ----------
const YES = ["listed_contact_provider", "confirmed_available", "deadline_listed", "expression_of_interest", "event_dependent"];
const MAYBE = ["request_subject_to_capacity", "intake_unconfirmed"];
const NO = ["temporarily_unavailable", "closed", "historical"];
const answerOf = (key) => (YES.includes(key) ? "yes" : NO.includes(key) ? "no" : MAYBE.includes(key) ? "maybe" : "yes");
export function availabilityHtml(key, note) {
  const a = answerOf(key);
  return `<div class="avail-pick" data-widget="availability" data-orig="${esc(key ?? "")}">
    <div class="seg-row" role="radiogroup" aria-label="Taking new people?">
      ${[["yes", "Yes"], ["no", "No"], ["maybe", "Maybe"]].map(([v, l]) => `<label class="seg-opt"><input type="radio" name="avail_answer" value="${v}" ${a === v ? "checked" : ""}><span>${l}</span></label>`).join("")}
    </div>
    <input name="availability_note" value="${esc(note ?? "")}" placeholder="Details (optional), e.g. Waitlist until March" aria-label="Availability details">
  </div>`;
}
export function readAvailability(form) {
  const w = form.querySelector('[data-widget="availability"]');
  const answer = form.querySelector('input[name="avail_answer"]:checked')?.value ?? "yes";
  const orig = w.dataset.orig;
  // Keep the precise original value when the answer didn't change.
  const availability = answerOf(orig) === answer && orig ? orig : { yes: "listed_contact_provider", no: "closed", maybe: "request_subject_to_capacity" }[answer];
  return { availability, availability_note: form.elements.availability_note.value.trim() };
}
export function setAvailability(form, answer, note) {
  const r = form.querySelector(`input[name="avail_answer"][value="${answer === "unsure" ? "maybe" : answer}"]`);
  if (r) r.checked = true;
  if (note) form.elements.availability_note.value = note;
}

// ---------- which details matter for a type of service ----------
const KIND = {
  contractor: ["plumbing", "sewer_cleaning", "waterproofing", "backwater_valve", "sump_pump_install", "mold_remediation", "mold_assessment", "cleanup"],
  program: ["financial_help", "insurance_help", "small_business_support", "workforce", "green_infrastructure", "climate_resilience"],
};
const DETAILS_FOR = {
  contractor: ["availability", "cost", "hours", "service_languages"],
  program: ["availability", "eligibility", "cost", "hours", "service_languages"],
  organization: ["availability", "eligibility", "cost", "hours", "service_languages"],
};
// Shown only when they have a value or someone adds them.
export const OPTIONAL_DETAILS = [["deadline", "Application Deadline"], ["accessibility", "Accessibility"]];
export const DETAIL_KEYS = ["availability", "eligibility", "cost", "hours", "deadline", "service_languages", "accessibility"];
export function kindOf(type) {
  if (!type) return null;
  return KIND.contractor.includes(type) ? "contractor" : KIND.program.includes(type) ? "program" : "organization";
}
export function detailsFor(type) {
  const k = kindOf(type);
  return k ? DETAILS_FOR[k] : DETAIL_KEYS.filter((d) => !OPTIONAL_DETAILS.some(([o]) => o === d));
}

// Cost range text from lookup keys ("free".."5"); "" when unknown.
export function costText(lo, hi) {
  const rank = (k) => COST_LEVELS.findIndex(([x]) => x === k);
  if (rank(lo) < 0 && rank(hi) < 0) return "";
  let a = rank(lo) < 0 ? hi : lo;
  let b = rank(hi) < 0 ? a : hi;
  if (rank(a) > rank(b)) [a, b] = [b, a];
  return a === b ? COST_LEVELS[rank(a)][1] : `${COST_LEVELS[rank(a)][1]}–${COST_LEVELS[rank(b)][1]}`;
}
// Hours text from lookup fields; "" when unknown.
export function hoursText(open247, list) {
  if (open247) return "Open 24/7";
  const days = Object.fromEntries((list ?? []).filter((d) => /^\d{2}:\d{2}$/.test(d.open) && /^\d{2}:\d{2}$/.test(d.close)).map((d) => [d.day, [d.open, d.close]]));
  return Object.keys(days).length ? formatHours(days) : "";
}

// Area picks (place ids) -> saved text, same as the picker writes.
export function areaFromIds(ids) {
  const known = (ids ?? []).filter((id) => byId.has(id));
  if (!known.length) return { service_area: "", places: "" };
  if (known.includes("citywide")) return { service_area: "Citywide", places: "New York City" };
  return { service_area: areaText(known), places: known.map((id) => byId.get(id).name).join(" | ") };
}
// Lookup's yes/no/maybe -> availability key.
export const availabilityKey = (answer) => ({ no: "closed", maybe: "request_subject_to_capacity", unsure: "request_subject_to_capacity" })[answer] ?? "listed_contact_provider";
