/**
 * Stories tab: neighborhood stories (an image plus a short text) that Flood
 * Chat shows as real examples. Replaces the Neighborhood Stories Google Sheet.
 *
 * Same shape as the other tabs: a list, a form, Upload CSV (the sheet's own
 * columns, so an exported sheet uploads as is), and Add Many (drop a batch of
 * images; AI drafts each story for a person to finish). Everything runs under
 * the signed-in person's own session; the database decides who may publish.
 */
import { areaHtml, readArea, chipsHtml, chipEvents, markDirty } from "./widgets.js";
import {
  KINDS, STAGES, AUDIENCES, SETTINGS, BUILDINGS, HAZARDS, LEVELS, PURPOSES, SHEET_COLUMNS, labelFor, fromSheetRow, toSheetRow,
} from "./stories-model.js";

let ctx; // helpers from editor.js
let PLACES = [];
const $ = (s, el = document) => el.querySelector(s);
const state = {
  list: { q: "", kind: "", stage: "", status: "", sort: "new" },
  editing: null,
  upload: { rows: null, file: null, newStatus: "draft", result: null },
  many: { rows: [], running: false, stop: false, ai: true, saveAs: "draft" },
};
const STATUS = { published: "Published", draft: "Draft", hidden: "Hidden" };
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function initStories(helpers) {
  ctx = helpers;
  PLACES = await (await fetch(new URL("./nyc-places.json", import.meta.url))).json();
  wireDialog();
}
export const storyTabs = { storiesImport: "stories", storiesMany: "stories" };
const live = () => ctx.data.stories.filter((s) => s.status !== "trashed");
export const storyCount = () => live().length;

// ---------- shared ----------
const esc = (s) => ctx.esc(s);
const placeText = (s) => (s.places?.length ? (s.places.includes("New York City") ? "All NYC" : s.places.map((p) => p.replace(/, (Manhattan|Brooklyn|Queens|Bronx|Staten Island)$/, "")).join(", ")) : "No place set");
const thumb = (s, size = 44) => s.image_url
  ? `<img class="story-thumb" src="${esc(s.image_url)}" alt="" width="${size}" height="${size}" loading="lazy">`
  : `<span class="story-thumb empty" aria-hidden="true">🖼</span>`;

async function uploadImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name}: images must be PNG, JPEG, WebP, or GIF.`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is over 10 MB.`);
  const path = `${crypto.randomUUID()}/${encodeURIComponent(file.name.replace(/[^\w.\- ]+/g, "-").replace(/\s+/g, "-"))}`;
  const r = await fetch(`${ctx.cfg.url}/storage/v1/object/stories/${path}`, {
    method: "POST",
    headers: { apikey: ctx.cfg.key, Authorization: `Bearer ${await ctx.accessToken()}`, "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  if (!r.ok) throw new Error(`Couldn't upload ${file.name}: ${(await r.json().catch(() => ({}))).message || r.status}`);
  return `${ctx.cfg.url}/storage/v1/object/public/stories/${path}`;
}

async function describe(imageUrl, hint = "") {
  const r = await fetch("/api/describe-story", {
    method: "POST",
    headers: { Authorization: `Bearer ${await ctx.accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, hint }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Description failed (${r.status}).`);
  return j.fields;
}

const save = (items, source = "editor") => ctx.rpc("fc_save_stories", { items, source });

// ---------- list ----------
const SORTS = { new: "Last updated (newest)", old: "Last updated (oldest)", no: "Number" };
export function storiesView() {
  const l = state.list;
  const q = l.q.toLowerCase();
  const all = live();
  const items = all
    .filter((s) => (!l.kind || s.kind === l.kind) && (!l.stage || s.stage === l.stage) && (!l.status || s.status === l.status))
    .filter((s) => !q || [s.text, s.alt_text, s.credit, (s.tags || []).join(" "), (s.places || []).join(" "), `#${s.story_no}`].join(" ").toLowerCase().includes(q))
    .sort(l.sort === "no" ? (a, b) => a.story_no - b.story_no : l.sort === "old" ? (a, b) => a.updated_at.localeCompare(b.updated_at) : (a, b) => b.updated_at.localeCompare(a.updated_at));
  const count = (k, v) => all.filter((s) => s[k] === v).length;
  const sel = (id, label, list, cur, k) => `<label class="inline">${label}<select id="${id}"><option value="">All</option>${list.map(([v, t]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${esc(t)} (${count(k, v)})</option>`).join("")}</select></label>`;
  const rows = items.map((s) => `<tr>
      <td>${thumb(s)}</td>
      <td class="clip-cell" title="${esc(s.text)}"><button class="link-btn name" data-story-edit="${s.id}">${esc(s.text)}</button><div class="sub">#${s.story_no} · ${esc(labelFor(KINDS, s.kind))} · ${esc(placeText(s))}${s.credit ? ` · ${esc(s.credit)}` : ""}</div></td>
      <td class="nowrap">${esc(labelFor(STAGES, s.stage))}</td>
      <td>${ctx.canPublish()
        ? `<select class="state ${s.status}" data-story-status="${s.id}" aria-label="Status of story ${s.story_no}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${s.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>`
        : `<span class="pill state ${s.status}">${STATUS[s.status]}</span>`}</td>
      <td class="sub nowrap">${esc(ctx.fmtDate(s.updated_at))}</td>
      <td><div class="row-actions">${ctx.iconBtn("edit", `Edit story ${s.story_no}`, `data-story-edit="${s.id}"`)}${ctx.canPublish() ? ctx.iconBtn("trash", `Move story ${s.story_no} to trash`, `data-story-trash="${s.id}"`, "danger") : ""}</div></td></tr>`).join("");
  const filtered = Boolean(l.q || l.kind || l.stage || l.status);
  return `<div class="bar">
      <input type="search" id="story-q" placeholder="Search Stories…" value="${esc(l.q)}" aria-label="Search stories">
      <span class="spacer"></span>
      <button class="btn" data-go="storiesImport">Upload CSV</button>
      <button class="btn" data-go="storiesMany">+ Add Many</button>
      <button class="btn primary" data-story-new>+ Add a Story</button>
    </div>
    <div class="bar filters-bar">
      <label class="inline">Sort<select id="story-sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${l.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      ${sel("story-kind", "Type", KINDS, l.kind, "kind")}
      ${sel("story-stage", "When", STAGES, l.stage, "stage")}
      ${sel("story-status-filter", "Status", Object.entries(STATUS), l.status, "status")}
      <span class="spacer"></span>
      <span class="sub" aria-live="polite">Showing ${items.length} of ${all.length}</span>
      ${filtered ? `<button class="link-btn" data-story-clear>Clear Filters</button>` : ""}
    </div>
    ${items.length ? `<table class="table compact stories"><colgroup><col class="c-thumb"><col class="c-name"><col class="c-when"><col class="c-status"><col class="c-date"><col class="c-act"></colgroup>
      <thead><tr><th></th><th>Story</th><th>When</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><h2>No stories ${all.length ? "match" : "yet"}.</h2><p>${all.length ? "Try clearing the filters." : "Add one, or upload the old sheet as a CSV."}</p></div>`}`;
}

// ---------- form ----------
const radios = (name, list, cur) => `<div class="checks" role="radiogroup">${list.map(([k, t]) => `<label><input type="radio" name="${name}" value="${k}" ${cur === k ? "checked" : ""}>${esc(t)}</label>`).join("")}</div>`;
const boxes = (name, list, cur = []) => `<div class="checks" role="group">${list.map(([k, t]) => `<label><input type="checkbox" name="${name}" value="${k}" ${cur.includes(k) ? "checked" : ""}>${esc(t)}</label>`).join("")}</div>`;
const select = (name, list, cur, blank = "Not set") => `<select name="${name}">${blank != null ? `<option value="">${blank}</option>` : ""}${list.map(([k, t]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const field = (key, label, html, { wide = true, hint = "", req = false } = {}) =>
  `<div class="field ${wide ? "wide" : ""}" data-field="${key}"><span>${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ""}</span>${html}${hint ? `<span class="hint">${hint}</span>` : ""}<span class="err"></span></div>`;

export function openStory(story = null, preset = {}) {
  const s = { kind: "photo", stage: "general", audience: "both", places: [], purposes: [], tags: [], building_types: [], status: ctx.canPublish() ? "published" : "draft", ...story, ...preset };
  state.editing = { story };
  const more = s.setting || s.hazard_type || s.building_types.length || s.risk_level || s.cost_tier;
  $("#story-title").textContent = story ? `Edit Story #${story.story_no}` : "Add a Story";
  $("#story-body").innerHTML = `
    <fieldset class="fgroup"><legend>Image</legend>
      <div class="field wide story-image" data-field="image_url">
        <div class="story-preview" id="story-preview">${s.image_url ? `<img src="${esc(s.image_url)}" alt="">` : `<span>No image yet</span>`}</div>
        <div class="story-image-controls">
          <label class="dropzone" id="story-drop"><input type="file" id="story-file" accept="image/png,image/jpeg,image/webp,image/gif"><span>🖼 <strong>Upload an image</strong> or drop it here</span></label>
          <label class="sub">or paste an image link<input name="image_url" type="url" value="${esc(s.image_url ?? "")}" placeholder="https://…/photo.jpg"></label>
          ${ctx.canPublish() ? `<button type="button" class="btn lookup" id="story-describe">✨ Describe With AI</button><span class="sub" id="story-describe-status" role="status">Fills in blank fields from the image.</span>` : ""}
          <span class="err"></span>
        </div>
      </div>
      ${field("alt_text", "Image Description", `<input name="alt_text" value="${esc(s.alt_text ?? "")}" placeholder="What the image shows, for people using screen readers">`, { hint: "Read aloud to people who can't see the image." })}
    </fieldset>
    <fieldset class="fgroup"><legend>Story</legend>
      ${field("text", "Story or Caption", `<textarea name="text" rows="4" placeholder="Alphonso Rosario, Brooklyn: “I had over $42,000 in damages…”">${esc(s.text ?? "")}</textarea>`, { req: true, hint: "What Flood Chat shows with the image. A quote, a short story, or what the image explains." })}
      ${field("kind", "Type", select("kind", KINDS, s.kind, null), { wide: false })}
    </fieldset>
    <fieldset class="fgroup"><legend>Where</legend>
      ${field("places", "Place", areaHtml(s.places.includes("New York City") ? "Citywide" : "", s.places.join(" | ")), { hint: "Pick NYC Citywide if it applies anywhere. Flood Chat prefers stories from the person's own neighborhood or borough." })}
    </fieldset>
    <fieldset class="fgroup"><legend>Who &amp; When</legend>
      ${field("stage", "When", radios("stage", STAGES, s.stage))}
      ${field("audience", "Who It's For", radios("audience", AUDIENCES, s.audience))}
      ${field("purposes", "What It Helps People Do", boxes("purposes", PURPOSES, s.purposes))}
      ${field("tags", "Other Tags", chipsHtml("tags", s.tags.join(" | "), "Add a word people might use, like “sump pump”, and press Enter"))}
    </fieldset>
    <details class="more-review wide story-more" ${more ? "open" : ""}><summary>More Details</summary>
      <div class="fgroup">
        ${field("setting", "Setting", radios("setting", [["", "Not set"], ...SETTINGS], s.setting ?? ""))}
        ${field("hazard_type", "Kind of Flooding", select("hazard_type", HAZARDS, s.hazard_type ?? ""), { wide: false })}
        ${field("risk_level", "Flood Risk Shown", select("risk_level", LEVELS, s.risk_level ?? ""), { wide: false })}
        ${field("building_types", "Building Type", boxes("building_types", BUILDINGS, s.building_types))}
        ${field("cost_tier", "Cost of What's Shown", select("cost_tier", LEVELS, s.cost_tier ?? ""), { wide: false, hint: "For fixes and products: roughly how expensive." })}
      </div>
    </details>
    <fieldset class="fgroup"><legend>Credit &amp; Source</legend>
      ${field("credit", "Credit", `<input name="credit" value="${esc(s.credit ?? "")}" placeholder="Photo by … / Illustration by …">`, { wide: false, hint: "Shown under the image." })}
      ${field("source_url", "Source Link", `<input name="source_url" type="url" value="${esc(s.source_url ?? "")}" placeholder="https://…">`, { wide: false, hint: "Where it was published." })}
    </fieldset>
    <fieldset class="fgroup"><legend>Visibility</legend>
      ${field("status", "Status", ctx.canPublish() ? select("status", Object.entries(STATUS), s.status, null) : `<input type="hidden" name="status" value="draft"><span class="pill state draft">Draft</span>`, { wide: false, hint: ctx.canPublish() ? "Published stories can appear in Flood Chat." : "An editor publishes it." })}
    </fieldset>
    ${story ? `<p class="sub" style="margin-top:18px">Story #${story.story_no} · added ${esc(ctx.fmtDate(story.created_at))}</p>` : ""}`;
  $("#story-error").textContent = "";
  $("#story-save").textContent = story ? "Save Changes" : "Add Story";
  $("#story-editor").showModal();
  $("#story-body textarea[name=text]")?.focus();
}

function readStory() {
  const f = $("#story-form");
  const val = (n) => f.elements[n]?.value?.trim() ?? "";
  // Keep the story's own order for choices still ticked, then add new ones.
  const checked = (n) => {
    const now = [...f.querySelectorAll(`input[name="${n}"]:checked`)].map((i) => i.value);
    const before = (state.editing.story?.[n] ?? []).filter?.((v) => now.includes(v)) ?? [];
    return [...new Set([...before, ...now])];
  };
  const area = readArea(f);
  return {
    image_url: val("image_url"), alt_text: val("alt_text"), text: val("text"), kind: val("kind"),
    places: String(area.places || "").split(/\s*\|\s*/).filter(Boolean),
    stage: checked("stage")[0] || "general", audience: checked("audience")[0] || "both", purposes: checked("purposes"),
    tags: val("tags").split(/\s*\|\s*/).filter(Boolean), setting: checked("setting")[0] || "", hazard_type: val("hazard_type"),
    risk_level: val("risk_level"), building_types: checked("building_types"), cost_tier: val("cost_tier"),
    credit: val("credit"), source_url: val("source_url"), status: val("status") || "draft",
  };
}

function showStoryErrors(errors) {
  for (const el of document.querySelectorAll("#story-body [data-field]")) {
    const msg = errors[el.dataset.field];
    el.classList.toggle("invalid", Boolean(msg));
    const e = el.querySelector(".err");
    if (e) e.textContent = msg || "";
  }
  const first = Object.keys(errors)[0];
  if (first) $(`#story-body [data-field="${first}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function validateStory(s) {
  const errors = {};
  if (!s.text) errors.text = "is required";
  for (const k of ["image_url", "source_url"]) if (s[k] && !/^https?:\/\/\S+$/.test(s[k])) errors[k] = "must be a full link starting with https://";
  if (s.status === "published" && !s.image_url) errors.image_url = "Add an image before publishing (or save as a draft)";
  return errors;
}

function setPreview(url) {
  $("#story-preview").innerHTML = url ? `<img src="${esc(url)}" alt="">` : `<span>No image yet</span>`;
}

// Fill blank fields from an AI description of the image (never overwrites what's typed).
function fillBlanks(f) {
  const form = $("#story-form");
  const mark = (name) => form.querySelector(`[data-field="${name}"]`)?.classList.add("ai-filled");
  const setText = (name, v) => { const el = form.elements[name]; if (el && !el.value.trim() && v) { el.value = v; mark(name); } };
  setText("alt_text", f.alt_text);
  setText("text", f.text);
  const setRadio = (name, v, blank) => {
    const cur = form.querySelector(`input[name="${name}"]:checked`)?.value ?? "";
    if ((cur === blank || cur === "") && v) { const el = form.querySelector(`input[name="${name}"][value="${v}"]`); if (el) { el.checked = true; mark(name); } }
  };
  setRadio("stage", f.stage, "general");
  setRadio("audience", f.audience, "both");
  setRadio("setting", f.setting, "");
  const setSelect = (name, v) => { const el = form.elements[name]; if (el && !el.value && v) { el.value = v; mark(name); } };
  setSelect("hazard_type", f.hazard_type);
  if (f.kind && form.elements.kind.value === "photo" && f.kind !== "photo") { form.elements.kind.value = f.kind; mark("kind"); }
  const setBoxes = (name, vs) => {
    const boxes = [...form.querySelectorAll(`input[name="${name}"]`)];
    if (boxes.some((b) => b.checked) || !vs?.length) return;
    for (const b of boxes) b.checked = vs.includes(b.value);
    mark(name);
  };
  setBoxes("purposes", f.purposes);
  setBoxes("building_types", f.building_types);
  if (!form.elements.tags.value && f.tags?.length) {
    const box = form.querySelector('[data-chips="tags"]');
    for (const t of f.tags) { box.querySelector(".chip-entry").value = t; chipEvents({ type: "focusout", target: box.querySelector(".chip-entry") }); }
    mark("tags");
  }
  if (f.setting || f.hazard_type || f.building_types?.length) form.querySelector(".story-more").open = true;
}

function wireDialog() {
  const body = $("#story-body");
  body.addEventListener("click", async (e) => {
    chipEvents(e);
    if (e.target.closest("#story-describe")) {
      const url = $("#story-form").elements.image_url.value.trim();
      const status = $("#story-describe-status");
      if (!url) return (status.textContent = "Add an image first.");
      const btn = e.target.closest("#story-describe");
      btn.disabled = true;
      status.textContent = "Looking at the image… (about 10–20 seconds)";
      try {
        fillBlanks(await describe(url, $("#story-form").elements.text.value));
        status.textContent = "Filled the blank fields (highlighted). Check them before saving.";
      } catch (err) {
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    }
  });
  body.addEventListener("keydown", chipEvents);
  body.addEventListener("focusout", chipEvents);
  for (const type of ["input", "change"]) body.addEventListener(type, (e) => {
    markDirty(e);
    e.target.closest(".ai-filled")?.classList.remove("ai-filled");
    if (e.target.name === "image_url") setPreview(e.target.value.trim());
  });
  const takeFile = async (file) => {
    if (!file) return;
    const status = $("#story-describe-status");
    try {
      if (status) status.textContent = `Uploading ${file.name}…`;
      const url = await uploadImage(file);
      $("#story-form").elements.image_url.value = url;
      setPreview(url);
      if (status) status.textContent = "Uploaded. ✨ Describe With AI can fill in the rest.";
    } catch (err) {
      $("#story-error").textContent = err.message;
    }
  };
  body.addEventListener("change", (e) => { if (e.target.id === "story-file") takeFile(e.target.files[0]); });
  body.addEventListener("dragover", (e) => { const z = e.target.closest("#story-drop"); if (z) { e.preventDefault(); z.classList.add("over"); } });
  body.addEventListener("dragleave", (e) => e.target.closest("#story-drop")?.classList.remove("over"));
  body.addEventListener("drop", (e) => { const z = e.target.closest("#story-drop"); if (!z) return; e.preventDefault(); z.classList.remove("over"); takeFile(e.dataTransfer.files[0]); });
  for (const b of document.querySelectorAll("#story-editor [data-close]")) b.onclick = () => $("#story-editor").close();

  $("#story-form").onsubmit = async (e) => {
    e.preventDefault();
    const s = readStory();
    const errors = validateStory(s);
    showStoryErrors(errors);
    if (Object.keys(errors).length) return ($("#story-error").textContent = "Fix the highlighted fields.");
    const old = state.editing.story;
    if (old && JSON.stringify(Object.fromEntries(Object.keys(s).map((k) => [k, old[k] ?? (Array.isArray(s[k]) ? [] : "")]))) === JSON.stringify(s)) {
      $("#story-editor").close();
      return ctx.flash("No changes to save.");
    }
    const btn = $("#story-save");
    btn.disabled = true;
    try {
      const [res] = await save([{ ...s, ...(old && { id: old.id, expected_updated_at: old.updated_at }) }]);
      $("#story-editor").close();
      await ctx.reload();
      ctx.flash(res.status === "published" ? `Story #${res.story_no} saved and published. Flood Chat picks it up within a few minutes.` : `Story #${res.story_no} saved as ${res.status === "draft" ? "a draft" : "hidden"}. It isn't public.`);
    } catch (err) {
      $("#story-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- Upload CSV ----------
const FIELD_COLUMNS = {
  status: ["status"], image_url: ["image_url", "imgur"], kind: ["image_type"], text: ["text"], alt_text: ["fallback_text"], places: ["location"],
  stage: ["flood_stage"], setting: ["setting"], risk_level: ["risk_level"], cost_tier: ["cost_tier"], audience: ["user_type"], hazard_type: ["hazard_type"],
  building_types: ["home_type"], purposes: ["use_case_tag"], tags: ["trigger_keywords", "home_type", "use_case_tag"], credit: ["source_caption"], source_url: ["source_url"],
};
const same = (a, b) => JSON.stringify(a ?? (Array.isArray(b) ? [] : "")) === JSON.stringify(b ?? (Array.isArray(a) ? [] : ""));
function planUpload(rows) {
  const byNo = new Map(ctx.data.stories.map((s) => [s.story_no, s]));
  return rows.map((raw, i) => {
    const { fields, notes } = fromSheetRow(raw, PLACES);
    const line = i + 2;
    const old = fields.story_no ? byNo.get(fields.story_no) : null;
    if (!old) {
      if (!fields.text) return { line, action: "skip", notes: ["No text, so it can't be added.", ...notes] };
      return { line, action: "add", fields, notes };
    }
    if (old.status === "trashed") return { line, action: "skip", old, notes: [`Story #${old.story_no} is in the trash. Restore it first.`] };
    // Blank cells leave the current value alone.
    for (const [k, cols] of Object.entries(FIELD_COLUMNS)) if (cols.every((c) => !String(raw[c] ?? "").trim())) delete fields[k];
    const changed = Object.keys(fields).filter((k) => k !== "story_no" && !(k === "status" && !fields.status) && !same(old[k], fields[k] === "" ? null : fields[k]) && !(fields[k] === "" && !old[k]));
    return { line, action: changed.length ? "update" : "same", fields, old, changed, notes };
  });
}

export function storiesImportView() {
  const u = state.upload;
  const plan = u.rows ? planUpload(u.rows) : null;
  const n = (a) => plan?.filter((p) => p.action === a).length ?? 0;
  const ACTION = { add: ["add", "New"], update: ["update", "Update"], same: ["unchanged", "No change"], skip: ["error", "Skipped"] };
  return `<section class="panel">
      <h2>Upload Stories (CSV)</h2>
      <p>Use the old Neighborhood Stories sheet as is (in Google Sheets: <em>File → Download → Comma-separated values</em>), or a CSV downloaded here. Rows whose <code>ID</code> matches a story update it; rows without an ID, or with a new one, are added. Blank cells and missing columns leave a story's current values alone.</p>
      <div class="bar">
        <label class="btn primary file-btn">Choose CSV File<input type="file" id="story-csv" accept=".csv,text/csv"></label>
        <button class="btn" data-story-template>Download Template</button>
        <button class="btn" data-story-export>Download All Stories (CSV)</button>
        <span class="spacer"></span><button class="btn" data-go="stories">Back to Stories</button>
      </div>
      ${u.file ? `<p class="sub">${esc(u.file)}</p>` : ""}
    </section>
    ${plan ? `<section class="panel">
      <div class="bar">
        <strong>${n("add")} new · ${n("update")} to update · ${n("same")} unchanged${n("skip") ? ` · ${n("skip")} skipped` : ""}</strong>
        <span class="spacer"></span>
        <label class="inline">New stories are <select id="story-new-status">${ctx.canPublish() ? `<option value="published" ${u.newStatus === "published" ? "selected" : ""}>Published</option>` : ""}<option value="draft" ${u.newStatus === "draft" ? "selected" : ""}>Drafts</option></select></label>
        <button class="btn primary" data-story-commit ${n("add") + n("update") ? "" : "disabled"}>Save ${n("add") + n("update")} Stor${n("add") + n("update") === 1 ? "y" : "ies"}</button>
      </div>
      <p class="sub">A row with its own <code>status</code> keeps it. Anything that didn't fit a choice is kept as a tag and noted below.</p>
      <table class="table"><thead><tr><th>Row</th><th></th><th>Story</th><th>Changes &amp; notes</th></tr></thead><tbody>${plan
        .filter((p) => p.action !== "same")
        .map((p) => `<tr><td class="sub">${p.line}</td><td><span class="pill ${ACTION[p.action][0]}">${ACTION[p.action][1]}</span></td>
          <td class="clip-cell" title="${esc(p.fields?.text ?? p.old?.text ?? "")}">${p.old ? `#${p.old.story_no} ` : ""}${esc((p.fields?.text ?? p.old?.text ?? "").slice(0, 90))}</td>
          <td class="sub">${esc([p.changed?.length ? `Changes: ${p.changed.join(", ")}` : "", ...p.notes].filter(Boolean).join(" "))}</td></tr>`)
        .join("")}</tbody></table>
    </section>` : ""}
    ${u.result ? `<section class="panel"><p>${esc(u.result)}</p></section>` : ""}`;
}

function parseCsv(file) {
  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    complete: (res) => {
      const headers = res.meta.fields ?? [];
      if (!headers.some((h) => ["text", "image_url", "ID"].includes(h))) {
        state.upload = { ...state.upload, rows: null, file: null };
        ctx.render();
        return ctx.flash("That file doesn't have the stories columns (text, image_url, ID…). Download the template to see them.", true);
      }
      Object.assign(state.upload, { rows: res.data, file: `${file.name}: ${res.data.length} rows`, result: null });
      ctx.render();
    },
    error: (err) => ctx.flash(`Couldn't read the CSV: ${err.message}`, true),
  });
}

async function commitUpload(btn) {
  const plan = planUpload(state.upload.rows);
  const items = plan.filter((p) => p.action === "add" || p.action === "update").map((p) => {
    const f = { ...p.fields, line: String(p.line) };
    if (p.action === "update") return Object.assign(f, { id: p.old.id, expected_updated_at: p.old.updated_at, status: f.status || p.old.status });
    return Object.assign(f, { status: f.status || state.upload.newStatus });
  });
  btn.disabled = true;
  try {
    await save(items, state.upload.file?.split(":")[0] || "CSV upload");
    const added = plan.filter((p) => p.action === "add").length;
    Object.assign(state.upload, { rows: null, result: `Saved: ${added} added, ${items.length - added} updated.` });
    await ctx.reload();
    ctx.flash(state.upload.result);
  } catch (err) {
    ctx.flash(`Nothing was saved. ${err.message}`, true);
    btn.disabled = false;
  }
}

// ---------- Add Many ----------
const MANY_STATE = { new: ["unchanged", "Waiting"], working: ["info", "Working…"], added: ["add", "Added"], problem: ["error", "Needs a person"] };
export function storiesManyView() {
  const m = state.many;
  const waiting = m.rows.filter((r) => ["new", "problem"].includes(r.state)).length;
  return `<section class="panel">
      <h2>Add Many Stories</h2>
      <p>Drop in a batch of images, or paste image links (one per line). Each becomes a story. ${ctx.canPublish() ? "With AI on, it looks at each image and drafts the caption, image description, and tags for you to check." : ""}</p>
      <form id="story-many-form" class="many-paste">
        <label class="dropzone" id="story-many-drop"><input type="file" id="story-many-files" multiple accept="image/png,image/jpeg,image/webp,image/gif"><span>🖼 <strong>Choose images</strong> or drop them here</span> <span class="sub">PNG, JPEG, WebP, or GIF, up to 10 MB each.</span></label>
        <textarea name="links" rows="3" placeholder="https://…/flooded-street.jpg&#10;https://…/sandbags.png"></textarea>
        <div class="bar"><button class="btn primary" type="submit">Add to List</button><span class="spacer"></span><button class="btn" type="button" data-go="stories">Back to Stories</button></div>
      </form>
    </section>
    ${m.rows.length ? `<section class="panel">
      <div class="bar">
        ${m.running ? `<button class="btn danger" data-story-many-stop>Stop After the Current Ones</button>` : `<button class="btn lookup" data-story-many-run ${waiting ? "" : "disabled"}>${m.ai && ctx.canPublish() ? "✨ Describe &amp; Add All" : "Add All"} (${waiting})</button>`}
        ${ctx.canPublish() ? `<label class="inline"><input type="checkbox" id="story-many-ai" ${m.ai ? "checked" : ""} ${m.running ? "disabled" : ""}> Describe with AI</label>` : ""}
        <label class="inline">Save as <select id="story-many-save-as" ${m.running ? "disabled" : ""}><option value="draft">Drafts (review before publishing)</option>${ctx.canPublish() ? `<option value="published" ${m.saveAs === "published" ? "selected" : ""}>Published right away</option>` : ""}</select></label>
        <span class="spacer"></span>${m.running ? "" : `<button class="link-btn" data-story-many-clear>Clear List</button>`}
      </div>
      ${m.ai && ctx.canPublish() ? `<p class="sub">Each image takes 10–20 seconds and costs roughly 2–5 cents. Keep this tab open while it runs.</p>` : `<p class="sub">Without AI, each story's text starts as the file name; open each one to write it.</p>`}
      <table class="table"><thead><tr><th></th><th>Image</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${m.rows.map((r, i) => {
        const [cls, label] = MANY_STATE[r.state];
        return `<tr><td>${r.preview ? `<img class="story-thumb" src="${esc(r.preview)}" alt="" width="44" height="44">` : ""}</td><td class="clip-cell">${esc(r.name)}</td><td><span class="pill ${cls}">${label}</span></td><td class="sub">${esc(r.note || "")}</td>
          <td><div class="row-actions">${r.state === "added" ? `<button class="btn" data-story-edit="${r.id}">Open</button>` : r.state === "working" ? "" : `<button class="btn danger" data-story-many-remove="${i}" aria-label="Remove">×</button>`}</div></td></tr>`;
      }).join("")}</tbody></table>
    </section>` : ""}`;
}

function addManyFiles(files) {
  for (const f of files) {
    if (!IMAGE_TYPES.includes(f.type)) { ctx.flash(`${f.name} isn't a PNG, JPEG, WebP, or GIF image.`, true); continue; }
    state.many.rows.push({ name: f.name, file: f, preview: URL.createObjectURL(f), state: "new" });
  }
  ctx.render();
}

async function addOne(r) {
  r.state = "working";
  r.note = "";
  ctx.render();
  try {
    if (!r.url) {
      r.note = "Uploading…";
      ctx.render();
      r.url = await uploadImage(r.file);
    }
    let f = {};
    if (state.many.ai && ctx.canPublish()) {
      r.note = "Looking at the image…";
      ctx.render();
      f = await describe(r.url);
    }
    const name = r.name.replace(/\.\w+$/, "").replace(/[-_]+/g, " ");
    const story = {
      image_url: r.url, text: f.text || name, alt_text: f.alt_text || "", kind: f.kind || "photo", stage: f.stage || "general",
      audience: f.audience || "both", setting: f.setting || "", hazard_type: f.hazard_type || "", purposes: f.purposes || [], tags: f.tags || [],
      building_types: f.building_types || [], places: [], status: state.many.saveAs,
    };
    const [res] = await save([story], "Add Many");
    Object.assign(r, { state: "added", id: res.id, note: `Story #${res.story_no}, ${res.status === "published" ? "published" : "saved as a draft"}. Add the place, credit, and source link.` });
  } catch (err) {
    Object.assign(r, { state: "problem", note: err.message });
  } finally {
    ctx.render();
  }
}

async function runMany() {
  const m = state.many;
  const queue = m.rows.filter((r) => ["new", "problem"].includes(r.state));
  if (!queue.length || m.running) return;
  Object.assign(m, { running: true, stop: false });
  ctx.render();
  const worker = async () => { while (queue.length && !m.stop) await addOne(queue.shift()); };
  await Promise.all([worker(), worker(), worker()]);
  m.running = false;
  await ctx.reload();
  ctx.flash(m.stop ? "Stopped. Everything added so far is saved." : "Done. Open each story to add its place, credit, and source.");
}

// ---------- events (called from editor.js) ----------
export function storyClick(t) {
  if ("storyNew" in t.dataset) return openStory(), true;
  if (t.dataset.storyEdit) return openStory(ctx.data.stories.find((s) => s.id === t.dataset.storyEdit)), true;
  if ("storyClear" in t.dataset) { Object.assign(state.list, { q: "", kind: "", stage: "", status: "" }); ctx.render(); return true; }
  if (t.dataset.storyTrash) {
    const s = ctx.data.stories.find((x) => x.id === t.dataset.storyTrash);
    if (confirm(`Move story #${s.story_no} to the trash? It stops being public. You can restore it from Trash.`)) ctx.act(() => ctx.rpc("fc_set_story_status", { story: s.id, target: "trashed" }), "Moved to trash.");
    return true;
  }
  if (t.dataset.storyRestore) return ctx.act(() => ctx.rpc("fc_set_story_status", { story: t.dataset.storyRestore, target: "restore" }), "Restored as a draft."), true;
  if ("storyTemplate" in t.dataset) return ctx.download("datasponge-stories-template.csv", ctx.toCsv(SHEET_COLUMNS, [toSheetRow({ story_no: "", status: "draft", image_url: "https://example.org/flooded-street.jpg", kind: "photo", text: "Water up to the curb on Beach 116th St after the July storm.", alt_text: "A flooded street with parked cars", places: ["Rockaway Park, Queens"], stage: "during", audience: "both", purposes: ["see_examples"], tags: ["street flooding"], building_types: [], credit: "Photo by a resident", source_url: "" })])), true;
  if ("storyExport" in t.dataset) return ctx.download(`datasponge-stories-${new Date().toISOString().slice(0, 10)}.csv`, ctx.toCsv(SHEET_COLUMNS, live().map(toSheetRow))), true;
  if ("storyCommit" in t.dataset) return commitUpload(t), true;
  if ("storyManyRun" in t.dataset) return runMany(), true;
  if ("storyManyStop" in t.dataset) { state.many.stop = true; t.disabled = true; return true; }
  if (t.dataset.storyManyRemove) { state.many.rows.splice(Number(t.dataset.storyManyRemove), 1); ctx.render(); return true; }
  if ("storyManyClear" in t.dataset) { state.many.rows = []; ctx.render(); return true; }
  return false;
}

export function storyChange(t) {
  const filter = { "story-sort": "sort", "story-kind": "kind", "story-stage": "stage", "story-status-filter": "status" }[t.id];
  if (filter) { state.list[filter] = t.value; ctx.render(); $("#" + t.id)?.focus(); return true; }
  if (t.dataset.storyStatus) {
    t.disabled = true;
    ctx.act(() => ctx.rpc("fc_set_story_status", { story: t.dataset.storyStatus, target: t.value }), { published: "Published. Flood Chat picks it up within a few minutes.", draft: "Moved to draft. It's no longer public.", hidden: "Hidden. It's no longer public." }[t.value]);
    return true;
  }
  if (t.id === "story-csv") { if (t.files[0]) parseCsv(t.files[0]); return true; }
  if (t.id === "story-new-status") { state.upload.newStatus = t.value; return true; }
  if (t.id === "story-many-files") { addManyFiles([...t.files]); return true; }
  if (t.id === "story-many-ai") { state.many.ai = t.checked; ctx.render(); return true; }
  if (t.id === "story-many-save-as") { state.many.saveAs = t.value; return true; }
  return false;
}

export function storyInput(t) {
  if (t.id !== "story-q") return false;
  state.list.q = t.value;
  const pos = t.selectionStart;
  ctx.render();
  const box = $("#story-q");
  box.focus();
  box.setSelectionRange(pos, pos);
  return true;
}

export function storySubmit(e) {
  if (e.target.id !== "story-many-form") return false;
  e.preventDefault();
  const links = e.target.links.value.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\/\S+$/.test(s));
  for (const url of links) state.many.rows.push({ name: url.split("/").pop().split("?")[0] || url, url, preview: url, state: "new" });
  e.target.links.value = "";
  ctx.render();
  return true;
}

export function storyDrop(e) {
  const z = e.target.closest("#story-many-drop");
  if (!z) return false;
  if (e.type === "dragover") { e.preventDefault(); z.classList.add("over"); }
  if (e.type === "dragleave") z.classList.remove("over");
  if (e.type === "drop") { e.preventDefault(); z.classList.remove("over"); addManyFiles([...e.dataTransfer.files]); }
  return true;
}

/** Trashed stories for the Trash tab. */
export function trashedStories() {
  return ctx.data.stories.filter((s) => s.status === "trashed");
}
