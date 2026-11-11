/**
 * The leads part of the Analytics tab: page views of Local Help (and Blue
 * Dots' Local Help page) and the calls, website visits, and emails they send
 * to listed partners (public.fc_lead_report, migration 017). Names are never
 * stored here: people who came from Blue Dots Urgent or Blue Dots show by
 * product, and each product's own admin shows who they are.
 */
const VIA = { bdu: "Blue Dots Urgent", bdu_sms: "Blue Dots Urgent (text)", bluedots: "Blue Dots", direct: "Directly or other sites" };
const KIND = { phone: "Call", website: "Website", email: "Email", other: "Link" };
const SITE = { "local-help": "Local Help", bluedots: "Blue Dots page" };

export function leadsHtml(r, esc, days) {
  const t = r.totals;
  const n = (x) => Number(x || 0).toLocaleString("en-US");
  const when = (s) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const from = Object.entries(t.by_via || {}).sort((a, b) => b[1] - a[1]);
  return `
    <h2 class="lead-h">Leads to partners</h2>
    <p class="sub">Views of <a href="https://localhelp.floodline.nyc" target="_blank" rel="noreferrer">Local Help</a> and Blue Dots' Local Help page, and the calls, website visits, and emails they send to listed partners.</p>
    <div class="lead-stats">
      <div class="lead-stat"><span>Directory page views</span><strong>${n(t.views)}</strong></div>
      <div class="lead-stat"><span>Unique visitors</span><strong>${n(t.visitors)}</strong></div>
      <div class="lead-stat"><span>Leads to partners</span><strong>${n(t.leads)}</strong><small>from ${n(t.leaders)} ${t.leaders === 1 ? "person" : "people"}</small></div>
      <div class="lead-stat"><span>Visitors came from</span>${from.length ? `<ul>${from.map(([k, v]) => `<li>${esc(VIA[k] ?? k)} <b>${n(v)}</b></li>`).join("")}</ul>` : "<small>No visits yet.</small>"}</div>
    </div>
    <h3 class="lead-h3">Leads by partner</h3>
    ${r.partners.length ? `<table class="table"><thead><tr><th>Partner</th><th>On</th><th>Calls</th><th>Website</th><th>Email</th><th>Total</th><th>People</th><th>Sent by BDU or Blue Dots</th><th>Last lead</th></tr></thead><tbody>${r.partners
      .map((p) => `<tr><td class="name">${esc(p.name)}</td><td class="sub">${esc(SITE[p.site] ?? p.site)}</td><td>${n(p.calls)}</td><td>${n(p.sites)}</td><td>${n(p.emails)}</td><td><b>${n(p.total)}</b></td><td>${n(p.people)}</td><td>${n(p.via_products)}</td><td class="sub">${esc(when(p.last_at))}</td></tr>`)
      .join("")}</tbody></table>` : `<div class="empty"><h2>No leads in the last ${days} days.</h2></div>`}
    <h3 class="lead-h3">Recent leads</h3>
    ${r.recent.length ? `<table class="table"><thead><tr><th>When</th><th>Partner</th><th>On</th><th>Type</th><th>Came from</th><th>Looking for</th></tr></thead><tbody>${r.recent
      .map((e) => `<tr><td class="sub">${esc(when(e.at))}</td><td class="name">${esc(e.listing_name ?? e.link_url ?? "")}</td><td class="sub">${esc(SITE[e.site] ?? e.site)}</td><td>${esc(KIND[e.link_kind] ?? e.link_kind ?? "")}</td><td>${esc(e.via ? VIA[e.via] ?? e.via : e.site === "bluedots" ? "Blue Dots" : e.referrer ?? "Directly")}${e.via || e.site === "bluedots" ? "" : ` <span class="sub">· visitor ${esc(e.visitor)}</span>`}</td><td class="sub">${esc([e.borough, e.need, e.search && `“${e.search}”`].filter(Boolean).join(" · ") || "—")}</td></tr>`)
      .join("")}</tbody></table>` : `<div class="empty"><h2>No leads in the last ${days} days.</h2></div>`}`;
}
