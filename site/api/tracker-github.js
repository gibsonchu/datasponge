// GitHub webhook for the team tracker (one per FloodLine repo, events: push and
// pull_request). A commit or pull request that mentions "FL-12" gets linked on
// FL-12 and moves it to In progress; "Fixes FL-12" marks it Fixed once it lands
// on the branch that deploys (a merged PR or a push to the default branch).
// Env: TRACKER_GITHUB_SECRET (webhook secret), TRACKER_GITHUB_KEY (tracker key named "github").
import { createHmac, timingSafeEqual } from "node:crypto";
import { config, json } from "./_lib/common.js";

function signed(raw, signature) {
  const secret = process.env.TRACKER_GITHUB_SECRET;
  if (!secret || !signature) return false;
  const a = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function mention(req) {
  if (!/\bFL-\d+/i.test(req.text || "")) return [];
  const r = await fetch(`${config.url}/rest/v1/rpc/fc_tracker_report`, {
    method: "POST",
    headers: { apikey: config.key, "Content-Type": "application/json" },
    body: JSON.stringify({ key: process.env.TRACKER_GITHUB_KEY || "", req: { action: "mention", ...req } }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || `tracker ${r.status}`);
  return j.touched;
}

export async function POST(request) {
  const raw = await request.text();
  if (!signed(raw, request.headers.get("x-hub-signature-256"))) return json(401, { error: "bad signature" });
  const event = request.headers.get("x-github-event");
  const p = JSON.parse(raw);
  const repo = p.repository?.name ?? "";
  const touched = [];

  if (event === "push" && Array.isArray(p.commits)) {
    const landed = p.ref === `refs/heads/${p.repository?.default_branch}`;
    for (const c of p.commits) {
      touched.push(...(await mention({
        text: c.message,
        link: c.url,
        link_label: `${repo} commit ${String(c.id).slice(0, 7)}`,
        merged: landed,
        actor: c.author?.name || p.pusher?.name || "GitHub",
      })));
    }
  } else if (event === "pull_request" && ["opened", "edited", "reopened", "closed"].includes(p.action)) {
    const pr = p.pull_request;
    if (p.action !== "closed" || pr.merged) {
      touched.push(...(await mention({
        text: `${pr.title}\n${pr.body || ""}`,
        link: pr.html_url,
        link_label: `${repo} PR #${pr.number}`,
        merged: Boolean(pr.merged) && pr.base?.ref === p.repository?.default_branch,
        actor: p.sender?.login || "GitHub",
      })));
    }
  }
  return json(200, { touched });
}
