/**
 * Leads tab: page views on Local Help and the calls, website visits, and
 * emails it sends to listed partners (public.fc_lead_report, migration 017).
 * Names are never stored here: people who came from Blue Dots Urgent or Blue
 * Dots show by product, and each product's own admin shows who they are.
 */
const RANGES = [7, 30, 90];
const VIA = { bdu: "Blue Dots Urgent", bdu_sms: "Blue Dots Urgent (text)", bluedots: "Blue Dots", direct: "Directly or other sites" };
const KIND = { phone: "Call", website: "Website", email: "Email", other: "Link" };
let days = 30;

export async function leadsView(el, { rpc, esc }) {
  el.innerHTML = '<p class="sub">Loading…</p>';
  let r;
  try {
    r = await rpc("fc_lead_report", { days });
  } catch (err) {
    el.innerHTML = `<div class="empty"><h2>Leads</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  const t = r.totals;
  const n = (x) => Number(x || 0).toLocaleString("en-US");
  const when = (s) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const from = Object.entries(t.by_via || {}).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `
    <div class="leads-head">
      <p class="sub">Views of <a href="https://localhelp.floodline.nyc" target="_blank" rel="noreferrer">Local Help</a> and the calls, website visits, and emails it sends to listed partners.</p>
      <div class="seg" role="radiogroup" aria-label="Time range">${RANGES.map((d) => `<label><input type="radio" name="lead-days" value="${d}" ${d === days ? "checked" : ""}><span>${d} days</span></label>`).join("")}</div>
    </div>
    <div class="lead-stats">
      <div class="lead-stat"><span>Page views</span><strong>${n(t.views)}</strong></div>
      <div class="lead-stat"><span>Unique visitors</span><strong>${n(t.visitors)}</strong></div>
      <div class="lead-stat"><span>Leads to partners</span><strong>${n(t.leads)}</strong><small>from ${n(t.leaders)} ${t.leaders === 1 ? "person" : "people"}</small></div>
      <div class="lead-stat"><span>Visitors came from</span>${from.length ? `<ul>${from.map(([k, v]) => `<li>${esc(VIA[k] ?? k)} <b>${n(v)}</b></li>`).join("")}</ul>` : "<small>No visits yet.</small>"}</div>
    </div>
    <h2 class="lead-h">Leads by partner</h2>
    ${r.partners.length ? `<table class="table"><thead><tr><th>Partner</th><th>Calls</th><th>Website</th><th>Email</th><th>Total</th><th>People</th><th>From Blue Dots</th><th>Last lead</th></tr></thead><tbody>${r.partners
      .map((p) => `<tr><td class="name">${esc(p.name)}</td><td>${n(p.calls)}</td><td>${n(p.sites)}</td><td>${n(p.emails)}</td><td><b>${n(p.total)}</b></td><td>${n(p.people)}</td><td>${n(p.via_products)}</td><td class="sub">${esc(when(p.last_at))}</td></tr>`)
      .join("")}</tbody></table>` : `<div class="empty"><h2>No leads in the last ${days} days.</h2></div>`}
    <h2 class="lead-h">Recent leads</h2>
    ${r.recent.length ? `<table class="table"><thead><tr><th>When</th><th>Partner</th><th>Type</th><th>Came from</th><th>Looking for</th></tr></thead><tbody>${r.recent
      .map((e) => `<tr><td class="sub">${esc(when(e.at))}</td><td class="name">${esc(e.listing_name ?? e.link_url ?? "")}</td><td>${esc(KIND[e.link_kind] ?? e.link_kind ?? "")}</td><td>${esc(e.via ? VIA[e.via] ?? e.via : e.referrer ?? "Directly")}${e.via ? "" : ` <span class="sub">· visitor ${esc(e.visitor)}</span>`}</td><td class="sub">${esc([e.borough, e.need, e.search && `“${e.search}”`].filter(Boolean).join(" · ") || "—")}</td></tr>`)
      .join("")}</tbody></table>` : `<div class="empty"><h2>No leads in the last ${days} days.</h2></div>`}`;
  el.querySelectorAll('input[name="lead-days"]').forEach((i) => (i.onchange = () => { days = Number(i.value); leadsView(el, { rpc, esc }); }));
}
