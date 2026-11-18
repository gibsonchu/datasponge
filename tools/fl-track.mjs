#!/usr/bin/env node
// fl-track: read and update the FloodLine team tracker (datasponge.floodline.nyc/tracker/)
// from any Claude Code session or terminal.
//
//   fl-track list [--product KEY] [--status STATUS] [--all]
//   fl-track add "Title" [--type bug|issue|feature] [--product KEY] [--details TEXT]
//                        [--status approved|in_progress|fixed] [--link URL] [--label TEXT]
//   fl-track update FL-12 [--status STATUS] [--priority urgent|high|normal|low]
//                         [--note TEXT] [--link URL] [--label TEXT]
//   fl-track products
//
// The product defaults to the one whose GitHub repo matches this folder's git remote.
// The key lives in ~/.config/floodline/tracker.env (FLOODLINE_TRACKER_KEY=...), never in a repo.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const URL_ = "https://fkngyqnhbzhanlxezcsz.supabase.co/rest/v1/rpc/fc_tracker_report";
const ANON = "sb_publishable_yzkcUEStX-atk-dHTMLq8A_GiPN4w0G";
const PAGE = "https://datasponge.floodline.nyc/tracker/";

function key() {
  if (process.env.FLOODLINE_TRACKER_KEY) return process.env.FLOODLINE_TRACKER_KEY;
  try {
    const m = readFileSync(`${homedir()}/.config/floodline/tracker.env`, "utf8").match(/FLOODLINE_TRACKER_KEY=(\S+)/);
    if (m) return m[1];
  } catch {}
  fail("No tracker key. Put FLOODLINE_TRACKER_KEY=... in ~/.config/floodline/tracker.env");
}

function fail(msg) {
  console.error(`fl-track: ${msg}`);
  process.exit(1);
}

async function call(req) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ key: key(), req }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) fail(j?.message || `tracker error ${r.status}`);
  return j;
}

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

// Every GitHub repo this folder's remotes point at (Urgent pushes to a `fork` remote, not origin).
function reposHere() {
  try {
    const out = execFileSync("git", ["remote", "-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return [...out.matchAll(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s/g)].map((m) => m[1].toLowerCase());
  } catch {
    return [];
  }
}

async function productHere(given) {
  if (given) return given;
  const repos = reposHere();
  if (!repos.length) return null;
  const { products } = await call({ action: "list", status: "none" });
  return products.find((p) => p.repo && repos.includes(p.repo.toLowerCase()))?.key ?? null;
}

const line = (i) => `${i.ref.padEnd(6)} ${i.status.padEnd(11)} ${i.kind.padEnd(7)} ${i.product.padEnd(17)} ${i.priority === "normal" ? "" : `[${i.priority}] `}${i.title}`;
const itemNo = (ref) => {
  const m = String(ref || "").match(/^(?:FL-)?(\d+)$/i);
  if (!m) fail(`expected an item like FL-12, got "${ref ?? ""}"`);
  return Number(m[1]);
};

const [cmd, ...rest] = process.argv.slice(2);
const o = parse(rest);

switch (cmd) {
  case "list": {
    const { items } = await call({ action: "list", product: o.product === "here" ? await productHere() : o.product, status: o.status, all: !!o.all });
    console.log(items.length ? items.map(line).join("\n") : "Nothing open.");
    break;
  }
  case "products": {
    const { products } = await call({ action: "list", status: "none" });
    console.log(products.map((p) => `${p.key.padEnd(18)} ${p.name}${p.repo ? `  (${p.repo})` : ""}`).join("\n"));
    break;
  }
  case "add": {
    const title = o._.join(" ").trim();
    if (!title) fail('add needs a title: fl-track add "Map pin is off" --type bug');
    const product = (await productHere(o.product)) || "other";
    const i = await call({ action: "add", title, kind: o.type || "bug", product, details: o.details || "", status: o.status, priority: o.priority, link: o.link, link_label: o.label });
    console.log(`${i.ref} added (${i.product}, ${i.status}). ${PAGE}#${i.ref}`);
    break;
  }
  case "update": {
    const i = await call({ action: "update", item: itemNo(o._[0]), status: o.status, priority: o.priority, note: o.note, link: o.link, link_label: o.label });
    console.log(`${i.ref} is ${i.status}. ${PAGE}#${i.ref}`);
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 13).map((l) => l.slice(3)).join("\n"));
}
