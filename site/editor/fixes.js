/**
 * Fixes tab: problem -> fix -> program links (fc_private.fix_paths, migration 014).
 * Flood Chat looks these up when someone asks how to fix, prevent, or pay for a
 * flooding problem. Contributors save drafts; publishing (editors) marks a fix
 * reviewed by that editor.
 */

let ctx; // helpers from editor.js
const $ = (s, el = document) => el.querySelector(s);
const state = { q: "", status: "" };
const STATUS = { published: "Published", draft: "Draft", hidden: "Hidden" };
const AUDIENCES = [["renter", "Renters"], ["homeowner", "Homeowners"], ["business_owner", "Business owners"]];

export function initFixes(helpers) {
  ctx = helpers;
  $("#fix-form").addEventListener("submit", submit);
  for (const b of document.querySelectorAll("#fix-editor [data-close]")) b.onclick = () => $("#fix-editor").close();
}

const live = () => ctx.data.fixes.filter((f) => f.status !== "trashed");
export const fixCount = () => live().length;
export const trashedFixes = () => ctx.data.fixes.filter((f) => f.status === "trashed");
const esc = (s) => ctx.esc(s);

/** Published services, for the program picker and names in the list. */
function services() {
  return ctx.data.items
    .filter((i) => i.standard === "FSS" && i.status !== "excluded")
    .map((i) => ({ id: i.id, name: i.record.title, published: i.status === "published" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const serviceName = (id) => services().find((s) => s.id === id)?.name ?? "A service that's no longer listed";

export function fixesView() {
  const all = live();
  const q = state.q.toLowerCase();
  const items = all
    .filter((f) => !state.status || f.status === state.status)
    .filter((f) => !q || [f.problem, f.fix, f.details, (f.keywords || []).join(" ")].join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.sort - b.sort || a.path_no - b.path_no);
  const who = (f) => f.audiences.map((a) => AUDIENCES.find(([k]) => k === a)?.[1] ?? a).join(", ");
  const rows = items.map((f) => `<tr>
      <td style="white-space:normal;min-width:16rem"><button class="link-btn name" style="white-space:normal;text-align:left" data-fix-edit="${f.id}">${esc(f.problem)}</button>
        <div class="sub">→ <strong>${esc(f.fix)}</strong> · ${esc(who(f))}</div>
        <div class="sub">${f.service_ids.length ? f.service_ids.map((id) => esc(serviceName(id))).join(" · ") : "No programs linked"}</div></td>
      <td class="nowrap">${f.reviewed_at ? `<span class="pill state published" title="Reviewed ${esc(ctx.fmtDate(f.reviewed_at))}">Reviewed</span>` : `<span class="pill state draft">Not reviewed</span>`}</td>
      <td>${ctx.canPublish()
        ? `<select class="state ${f.status}" data-fix-status="${f.id}" aria-label="Status of fix ${f.path_no}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>`
        : `<span class="pill state ${f.status}">${STATUS[f.status]}</span>`}</td>
      <td class="sub nowrap">${esc(ctx.fmtDate(f.updated_at))}</td>
      <td><div class="row-actions">${ctx.iconBtn("edit", `Edit fix ${f.path_no}`, `data-fix-edit="${f.id}"`)}${ctx.canPublish() ? ctx.iconBtn("trash", `Move fix ${f.path_no} to trash`, `data-fix-trash="${f.id}"`, "danger") : ""}</div></td></tr>`).join("");
  const unreviewed = all.filter((f) => f.status === "published" && !f.reviewed_at).length;
  return `<p class="sub" style="max-width:70ch">What Flood Chat recommends when someone asks how to fix, prevent, or pay for a flooding problem: the fix, and the programs that help. ${unreviewed ? `<strong>${unreviewed} published fix${unreviewed === 1 ? " hasn't" : "es haven't"} been reviewed yet.</strong> Open one, check it, and choose Publish as Reviewed.` : ""}</p>
    <div class="bar">
      <input type="search" id="fix-q" placeholder="Search Fixes…" value="${esc(state.q)}" aria-label="Search fixes">
      <label class="inline">Status<select id="fix-status-filter"><option value="">All</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${state.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <span class="spacer"></span>
      <button class="btn primary" data-fix-new>+ Add a Fix</button>
    </div>
    ${items.length ? `<table class="table compact"><thead><tr><th>Problem → Fix</th><th>Review</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><h2>No fixes ${all.length ? "match" : "yet"}.</h2><p>${all.length ? "Try clearing the search." : "Add the first one."}</p></div>`}`;
}

function openFix(fix = null) {
  const f = { audiences: ["homeowner"], keywords: [], service_ids: [], sort: 100, status: ctx.canPublish() ? "published" : "draft", ...fix };
  $("#fix-title").textContent = fix ? `Edit Fix #${fix.path_no}` : "Add a Fix";
  $("#fix-error").textContent = "";
  const svc = services();
  $("#fix-body").innerHTML = `
    <div class="field wide"><span>Problem <span class="req" aria-hidden="true">*</span></span><input name="problem" required maxlength="300" value="${esc(f.problem ?? "")}" placeholder="e.g. Sewage backs up through basement drains during heavy rain"><span class="hint">In the words a resident would use.</span></div>
    <div class="field wide"><span>Who it's for <span class="req" aria-hidden="true">*</span></span><div class="checks" role="group">${AUDIENCES.map(([k, t]) => `<label><input type="checkbox" name="audiences" value="${k}" ${f.audiences.includes(k) ? "checked" : ""}>${t}</label>`).join("")}</div></div>
    <div class="field wide"><span>Fix <span class="req" aria-hidden="true">*</span></span><input name="fix" required maxlength="200" value="${esc(f.fix ?? "")}" placeholder="e.g. Backwater valve"></div>
    <div class="field wide"><span>Details</span><textarea name="details" rows="4" maxlength="2000" placeholder="What it is, why it helps, who installs it, anything to know first.">${esc(f.details ?? "")}</textarea></div>
    <div class="field wide"><span>Programs that help</span>
      <div class="checks" role="group" style="max-height:14rem;overflow:auto">${svc.map((s) => `<label><input type="checkbox" name="service_ids" value="${s.id}" ${f.service_ids.includes(s.id) ? "checked" : ""}>${esc(s.name)}${s.published ? "" : ' <span class="sub">(not public)</span>'}</label>`).join("")}</div>
      <span class="hint">Pick from Services. Only public, open services are shown to Flood Chat.</span></div>
    <div class="field wide"><span>Search words</span><input name="keywords" value="${esc((f.keywords || []).join(", "))}" placeholder="sewer backup, sewage, floor drain"><span class="hint">Comma-separated words people use for this problem. Flood Chat matches on these.</span></div>
    <div class="field"><span>Order</span><input name="sort" type="number" min="0" max="9999" value="${esc(String(f.sort ?? 100))}"><span class="hint">Lower shows first for general questions.</span></div>`;
  $("#fix-save").textContent = fix ? "Save" : "Add Fix";
  const pub = $("#fix-save-reviewed");
  pub.hidden = !ctx.canPublish();
  $("#fix-form").dataset.id = fix?.id ?? "";
  $("#fix-form").dataset.updated = fix?.updated_at ?? "";
  $("#fix-editor").showModal();
}

async function submit(e) {
  e.preventDefault();
  const form = e.target;
  const reviewed = e.submitter?.id === "fix-save-reviewed";
  const el = form.elements;
  const audiences = [...form.querySelectorAll('input[name="audiences"]:checked')].map((i) => i.value);
  const item = {
    ...(form.dataset.id ? { id: form.dataset.id, expected_updated_at: form.dataset.updated } : {}),
    problem: el.problem.value.trim(),
    fix: el.fix.value.trim(),
    details: el.details.value.trim(),
    audiences,
    service_ids: [...form.querySelectorAll('input[name="service_ids"]:checked')].map((i) => i.value),
    keywords: el.keywords.value.split(",").map((k) => k.trim()).filter(Boolean),
    sort: el.sort.value,
    ...(reviewed ? { status: "published", reviewed: true } : form.dataset.id ? {} : { status: ctx.canPublish() ? "published" : "draft" }),
  };
  if (!item.problem || !item.fix) return ($("#fix-error").textContent = "Add the problem and the fix.");
  if (!audiences.length) return ($("#fix-error").textContent = "Choose who it's for.");
  try {
    await ctx.rpc("fc_save_fix_paths", { items: [item] });
    $("#fix-editor").close();
    ctx.flash(reviewed ? "Published as reviewed. Flood Chat picks it up within a few minutes." : "Saved.");
    await ctx.reload();
  } catch (err) {
    $("#fix-error").textContent = err.message;
  }
}

// ---------- events (called from editor.js) ----------
export function fixClick(t) {
  if ("fixNew" in t.dataset) return openFix(), true;
  if (t.dataset.fixEdit) return openFix(ctx.data.fixes.find((f) => f.id === t.dataset.fixEdit)), true;
  if (t.dataset.fixTrash) {
    const f = ctx.data.fixes.find((x) => x.id === t.dataset.fixTrash);
    if (confirm(`Move fix #${f.path_no} to the trash? Flood Chat stops using it. You can restore it from Trash.`)) ctx.act(() => ctx.rpc("fc_set_fix_path_status", { path: f.id, target: "trashed" }), "Moved to trash.");
    return true;
  }
  if (t.dataset.fixRestore) return ctx.act(() => ctx.rpc("fc_set_fix_path_status", { path: t.dataset.fixRestore, target: "restore" }), "Restored as a draft."), true;
  return false;
}

export function fixChange(t) {
  if (t.id === "fix-status-filter") { state.status = t.value; ctx.render(); return true; }
  if (t.dataset.fixStatus) {
    t.disabled = true;
    ctx.act(() => ctx.rpc("fc_set_fix_path_status", { path: t.dataset.fixStatus, target: t.value }), { published: "Published and marked reviewed. Flood Chat picks it up within a few minutes.", draft: "Moved to draft. Flood Chat stops using it.", hidden: "Hidden. Flood Chat stops using it." }[t.value]);
    return true;
  }
  return false;
}

export function fixInput(t) {
  if (t.id !== "fix-q") return false;
  state.q = t.value;
  const pos = t.selectionStart;
  ctx.render();
  const box = $("#fix-q");
  box.focus();
  box.setSelectionRange(pos, pos);
  return true;
}
