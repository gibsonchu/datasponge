/**
 * Analytics tab (team only): every FloodLine site in one place.
 *  - Traffic: a daily copy of Google Analytics (fc_dashboard; copied by Blue
 *    Dots' traffic-to-datasponge job, migration 018).
 *  - Important actions as they happen: chats, sign-ups, reports, requests.
 *  - Leads to partners (leads.js, migration 017).
 */
import { leadsHtml } from "./leads.js";

const RANGES = [7, 30, 90];
const SITES = [
  ["local-help", "Local Help", "localhelp.floodline.nyc"],
  ["bdu", "Blue Dots Urgent", "urgent.bluedots.nyc"],
  ["bluedots", "Blue Dots", "bluedots.nyc"],
];
const ACTIONS = {
  chat_started: "Chats started",
  urgent_chat: "Urgent chats",
  signup: "Sign-ups",
  signup_again: "Sign-ups by people already subscribed",
  flood_report: "Flood reports",
  assessment_request: "Assessment requests",
  solution_submission: "Blue Dot submissions",
};
let days = 30;

const n = (x) => Number(x || 0).toLocaleString("en-US");
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// One site's visits per day: thin bars, rounded tops on the baseline, hover shows the day.
function visitsChart(points, esc, label) {
  const W = 320, H = 84, pad = 2;
  const max = Math.max(1, ...points.map((p) => p.v));
  const step = W / points.length;
  const bw = Math.max(2, Math.min(14, step - 2));
  const bars = points
    .map((p, i) => {
      const h = p.v ? Math.max(3, (p.v / max) * (H - pad)) : 0;
      const x = i * step + (step - bw) / 2;
      return `<g class="bar"><rect class="hit" x="${i * step}" y="0" width="${step}" height="${H}"></rect>${h ? `<rect class="mark" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"></rect>` : ""}<title>${esc(dayLabel(p.d))}: ${n(p.v)} visits</title></g>`;
    })
    .join("");
  return `<figure class="spark"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">${bars}<line class="base" x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}"></line></svg>
    <figcaption><span>${esc(dayLabel(points[0].d))}</span><span>busiest day ${n(max)}</span><span>${esc(dayLabel(points.at(-1).d))}</span></figcaption></figure>`;
}

export async function analyticsView(el, { rpc, esc }) {
  el.innerHTML = '<p class="sub">Loading…</p>';
  const [dash, leads] = await Promise.allSettled([rpc("fc_dashboard", { days }), rpc("fc_lead_report", { days })]);
  const d = dash.status === "fulfilled" ? dash.value : null;

  // Every day in the range up to yesterday (New York), so quiet days show as gaps, not missing bars.
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const range = Array.from({ length: days }, (_, i) => {
    const x = new Date(today);
    x.setDate(x.getDate() - days + i);
    return x.toLocaleDateString("en-CA");
  });

  const traffic = d
    ? `<div class="site-grid">${SITES.map(([key, name, host]) => {
        const t = d.traffic.find((x) => x.site === key) ?? {};
        const byDay = new Map(d.daily.filter((x) => x.site === key).map((x) => [x.day, Number(x.visits)]));
        const pages = d.pages.filter((x) => x.site === key).slice(0, 5);
        const sources = d.sources.filter((x) => x.site === key).slice(0, 4);
        return `<section class="site-card">
          <h3>${esc(name)} <a class="sub" href="https://${host}" target="_blank" rel="noreferrer">${esc(host)} ↗</a></h3>
          <div class="site-nums"><div><span>Visits</span><strong>${n(t.visits)}</strong></div><div><span>Page views</span><strong>${n(t.views)}</strong></div></div>
          <p class="chart-title">Visits per day</p>
          ${visitsChart(range.map((day) => ({ d: day, v: byDay.get(day) ?? 0 })), esc, `${name}: visits per day`)}
          <div class="site-lists">
            <div><p class="chart-title">Top pages</p>${pages.length ? `<ol>${pages.map((p) => `<li><span>${esc(p.label)}</span><b>${n(p.total)}</b></li>`).join("")}</ol>` : '<p class="sub">No data yet.</p>'}</div>
            <div><p class="chart-title">Where visits came from</p>${sources.length ? `<ol>${sources.map((p) => `<li><span>${esc(p.label)}</span><b>${n(p.total)}</b></li>`).join("")}</ol>` : '<p class="sub">No data yet.</p>'}</div>
          </div>
        </section>`;
      }).join("")}</div>
      <p class="sub">${d.traffic_through ? `From Google Analytics, copied daily; through ${esc(dayLabel(d.traffic_through))}.` : "Google Analytics numbers start appearing after the first daily copy."}</p>`
    : `<div class="empty"><p>${esc(dash.reason?.message ?? "Traffic isn't available.")}</p></div>`;

  const actions = d
    ? d.actions.length
      ? `<table class="table"><thead><tr><th>Site</th><th>Action</th><th>Count</th><th>Last</th></tr></thead><tbody>${d.actions
          .map((a) => `<tr><td class="sub">${esc(SITES.find((s) => s[0] === a.site)?.[1] ?? a.site)}</td><td class="name">${esc(ACTIONS[a.name] ?? a.name.replaceAll("_", " "))}</td><td><b>${n(a.total)}</b></td><td class="sub">${esc(new Date(a.last_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td></tr>`)
          .join("")}</tbody></table>`
      : `<div class="empty"><h2>No actions in the last ${days} days.</h2><p>Chats, sign-ups, flood reports, and requests show up here as they happen.</p></div>`
    : "";

  el.innerHTML = `
    <div class="leads-head">
      <p class="sub">Local Help, Blue Dots Urgent, and Blue Dots together. For the team.</p>
      <div class="seg" role="radiogroup" aria-label="Time range">${RANGES.map((r) => `<label><input type="radio" name="an-days" value="${r}" ${r === days ? "checked" : ""}><span>${r} days</span></label>`).join("")}</div>
    </div>
    <h2 class="lead-h">Traffic</h2>
    ${traffic}
    ${d ? `<h2 class="lead-h">Important actions</h2>${actions}` : ""}
    ${leads.status === "fulfilled" ? leadsHtml(leads.value, esc, days) : `<div class="empty"><p>${esc(leads.reason?.message ?? "Leads aren't available.")}</p></div>`}`;
  el.querySelectorAll('input[name="an-days"]').forEach((i) => (i.onchange = () => { days = Number(i.value); analyticsView(el, { rpc, esc }); }));
}
