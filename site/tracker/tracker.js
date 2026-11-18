/**
 * FloodLine Tracker: bugs, issues, and feature requests for every FloodLine
 * product. Members sign in with their DataSponge account; every read and write
 * goes through the database's own rules with their token (fc_tracker*). Team
 * submissions wait "For review" until an admin decides. Claude Code sessions
 * and GitHub update items through fc_tracker_report with their own keys.
 */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STATUS = { review: "For review", approved: "Approved", in_progress: "In progress", fixed: "Fixed", rejected: "Rejected" };
const KIND = { bug: "Bug", issue: "Issue", feature: "Feature request" };
const PRIORITY = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const TABS = {
  review: { label: "For review", test: (i) => i.status === "review" },
  open: { label: "Open", test: (i) => ["approved", "in_progress"].includes(i.status) },
  done: { label: "Done", test: (i) => ["fixed", "rejected"].includes(i.status) },
  all: { label: "All", test: () => true },
};

const cfg = await (await fetch("/config.json", { cache: "no-cache" })).json();
let session = JSON.parse(sessionStorage.getItem("fc_workspace_session") || "null");
let state = { me: "", admin: false, products: [], items: [] };
let tab = "open";
let openId = null;

// ---------- auth (same account and session as the DataSponge Editor) ----------
function saveSession(s) {
  session = s && {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: Number(s.expires_at) || Math.floor(Date.now() / 1000) + Number(s.expires_in || 3600),
    email: s.user?.email ?? session?.email ?? null,
  };
  session ? sessionStorage.setItem("fc_workspace_session", JSON.stringify(session)) : sessionStorage.removeItem("fc_workspace_session");
}
async function gotrue(path, body, { method = "POST", auth = false } = {}) {
  const headers = { apikey: cfg.key, "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${session.access_token}`;
  const r = await fetch(`${cfg.url}/auth/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Sign-in could not be completed.");
  return j;
}
async function accessToken() {
  if (!session) throw Object.assign(new Error("Sign in again."), { auth: true });
  if (session.expires_at * 1000 - Date.now() < 60_000) {
    try {
      saveSession(await gotrue("/token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
    } catch {
      saveSession(null);
      throw Object.assign(new Error("Your session ended. Sign in again."), { auth: true });
    }
  }
  return session.access_token;
}
async function rpc(fn, args = {}) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.message || `Something went wrong (${r.status}).`), { code: j?.code });
  return j;
}

function show(which) {
  for (const id of ["login", "not-member", "app"]) $("#" + id).hidden = id !== which;
  $("#who").hidden = which !== "app";
}
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2500);
}

$("#password-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#login-msg");
  msg.className = "msg";
  msg.textContent = "Signing in…";
  try {
    saveSession(await gotrue("/token?grant_type=password", { email: f.email.value.trim(), password: f.password.value }));
    f.reset();
    msg.textContent = "";
    await start();
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = /invalid/i.test(err.message) ? "That email and password don't match." : err.message;
  }
};
$("#link-form").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("#login-msg");
  try {
    await gotrue(`/otp?redirect_to=${encodeURIComponent(location.origin + "/tracker/")}`, { email: e.target.email.value.trim(), create_user: false });
    msg.className = "msg";
    msg.textContent = "Check your email for a sign-in link.";
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
  }
};
async function signOut() {
  if (session) await gotrue("/logout", null, { auth: true }).catch(() => {});
  saveSession(null);
  show("login");
}
$("#sign-out").onclick = signOut;
$("#nm-out").onclick = signOut;

function takeHashSession() {
  if (!location.hash.includes("access_token=") && !location.hash.includes("error=")) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  if (p.get("error")) {
    $("#login-msg").className = "msg bad";
    $("#login-msg").textContent = p.get("error_description") || "That link didn't work. Request a new one.";
    return;
  }
  saveSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_at: p.get("expires_at"), expires_in: p.get("expires_in") });
}

// ---------- data ----------
async function load() {
  state = await rpc("fc_tracker");
  render();
}
async function start() {
  try {
    await load();
  } catch (err) {
    if (err.auth) return show("login");
    if (err.code === "42501") {
      $("#nm-email").textContent = session?.email || "your email";
      return show("not-member");
    }
    throw err;
  }
  $("#me").textContent = state.me;
  fillProducts();
  const m = location.hash.match(/^#FL-(\d+)$/i);
  if (m) {
    openId = Number(m[1]);
    const it = state.items.find((i) => i.id === openId);
    if (it) tab = Object.keys(TABS).find((k) => k !== "all" && TABS[k].test(it)) || "all";
  } else if (state.admin && state.items.some(TABS.review.test)) tab = "review";
  show("app");
  render();
  if (openId) document.getElementById(`FL-${openId}`)?.scrollIntoView({ block: "center" });
}
const productName = (key) => state.products.find((p) => p.key === key)?.name || key;

function fillProducts() {
  const opts = state.products.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("");
  $("#new-form [name=product]").innerHTML = `<option value="">Choose…</option>${opts}`;
  $("#f-product").innerHTML = `<option value="">All products</option>${opts}`;
}

// ---------- render ----------
function visible() {
  const p = $("#f-product").value;
  const k = $("#f-kind").value;
  const q = $("#f-q").value.trim().toLowerCase();
  return state.items
    .filter(TABS[tab].test)
    .filter((i) => (!p || i.product === p) && (!k || i.kind === k))
    .filter((i) => !q || `${i.ref} ${i.title} ${i.details} ${i.submitted_by}`.toLowerCase().includes(q))
    .sort((a, b) => (tab === "open" ? PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] : 0) || b.updated_at.localeCompare(a.updated_at));
}

function render() {
  $("#tabs").innerHTML = Object.entries(TABS)
    .map(([k, t]) => {
      const n = state.items.filter(t.test).length;
      const hot = k === "review" && n > 0 ? " hot" : "";
      return `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${t.label}<span class="n${hot}">${n}</span></button>`;
    })
    .join("");
  const list = visible();
  $("#items").innerHTML = list.length ? list.map(itemHtml).join("") : `<li class="empty">${tab === "review" ? "Nothing waiting for review." : "Nothing here."}</li>`;
}

const when = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const whenFull = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function itemHtml(i) {
  const isOpen = i.id === openId;
  return `<li class="item" id="${i.ref}">
    <button type="button" data-open="${i.id}" aria-expanded="${isOpen}">
      <div class="title">${esc(i.title)}</div>
      <div class="meta">
        <span class="ref">${i.ref}</span>
        <span class="pill ${i.status}">${STATUS[i.status]}</span>
        ${i.priority !== "normal" ? `<span class="pill ${i.priority}">${PRIORITY[i.priority]}</span>` : ""}
        <span>${esc(productName(i.product))}</span>·<span>${KIND[i.kind]}</span>·<span>${esc(i.submitted_by)}</span>·<span>${when(i.updated_at)}</span>
      </div>
    </button>
    ${isOpen ? openHtml(i) : ""}
  </li>`;
}

function openHtml(i) {
  const links = i.links.length
    ? `<ul class="links">${i.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.label)} ↗</a></li>`).join("")}</ul>`
    : "";
  const decide = state.admin
    ? `<div class="decide" data-item="${i.id}">
        ${i.status === "review" ? `<button class="btn good" type="button" data-set="approved">Approve</button><button class="btn bad" type="button" data-set="rejected">Reject</button>` : ""}
        <label class="sr">Status <select data-field="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === i.status ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="sr">Priority <select data-field="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${k === i.priority ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      </div>`
    : "";
  return `<div class="open">
    ${i.details ? `<p class="details">${esc(i.details)}</p>` : ""}
    ${links}
    ${decide}
    <ul class="history">${i.history.map((h) => `<li>${whenFull(h.at)} · <b>${esc(h.actor)}</b> · ${esc(h.what)}</li>`).join("")}</ul>
    <form class="comment" data-item="${i.id}">
      <input name="note" placeholder="Add a comment or link" maxlength="4000" aria-label="Comment">
      <button class="btn" type="submit">Add</button>
    </form>
  </div>`;
}

function linkLabel(url) {
  const g = url.match(/github\.com\/[^/]+\/([^/]+)\/(pull|issues|commit)\/([0-9a-f]+)/i);
  if (g) return g[2] === "commit" ? `${g[1]} commit ${g[3].slice(0, 7)}` : `${g[1]} ${g[2] === "pull" ? "PR" : "issue"} #${g[3]}`;
  return new URL(url).hostname;
}

async function update(id, req) {
  const updated = await rpc("fc_tracker_update", { item: id, req });
  state.items = state.items.map((i) => (i.id === id ? updated : i));
  render();
}

// ---------- events ----------
$("#tabs").onclick = (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  render();
};
for (const id of ["#f-product", "#f-kind", "#f-q"]) $(id).oninput = render;

$("#items").onclick = async (e) => {
  const o = e.target.closest("[data-open]");
  if (o) {
    const id = Number(o.dataset.open);
    openId = openId === id ? null : id;
    history.replaceState(null, "", openId ? `#FL-${openId}` : location.pathname);
    return render();
  }
  const s = e.target.closest("[data-set]");
  if (s) {
    s.disabled = true;
    try {
      await update(Number(s.closest("[data-item]").dataset.item), { status: s.dataset.set });
      toast(s.dataset.set === "approved" ? "Approved" : "Rejected");
    } catch (err) {
      toast(err.message);
      s.disabled = false;
    }
  }
};
$("#items").onchange = async (e) => {
  const f = e.target.closest("[data-field]");
  if (!f) return;
  try {
    await update(Number(f.closest("[data-item]").dataset.item), { [f.dataset.field]: f.value });
    toast("Saved");
  } catch (err) {
    toast(err.message);
  }
};
$("#items").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const text = f.note.value.trim();
  if (!text) return;
  const link = text.match(/^https:\/\/\S+$/) ? text : null;
  try {
    await update(Number(f.dataset.item), link ? { link, link_label: linkLabel(link) } : { note: text });
    toast("Added");
  } catch (err) {
    toast(err.message);
  }
};

$("#new-btn").onclick = () => {
  $("#new-form").hidden = false;
  $("#new-form [name=title]").focus();
};
$("#new-cancel").onclick = () => {
  $("#new-form").reset();
  $("#new-form").hidden = true;
};
$("#new-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $(".msg", f);
  if (!f.product.value) {
    msg.className = "msg bad";
    msg.textContent = "Choose a product.";
    return;
  }
  msg.className = "msg";
  msg.textContent = "Sending…";
  try {
    const item = await rpc("fc_tracker_submit", { req: { product: f.product.value, kind: f.kind.value, title: f.title.value, details: f.details.value } });
    state.items.unshift(item);
    f.reset();
    f.hidden = true;
    msg.textContent = "";
    tab = TABS.review.test(item) ? "review" : "open";
    openId = item.id;
    render();
    toast(item.status === "review" ? `${item.ref} sent to Gibson for review` : `${item.ref} added`);
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
  }
};
$("#new-form").oninput = () => ($(".msg", $("#new-form")).textContent = "");

// ---------- boot ----------
takeHashSession();
if (session) start().catch((err) => { show("login"); $("#login-msg").textContent = err.message; });
else show("login");
