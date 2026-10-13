// Shared by the AI endpoints. Files under api/_lib are not routes.
import Anthropic from "@anthropic-ai/sdk";
import taxonomy from "../../standards/taxonomy.json" with { type: "json" };
import config from "../../config.json" with { type: "json" };

export { Anthropic, config };
export const MODEL = "claude-opus-5-5";
export const termKeys = (dim) => taxonomy.filter((t) => t.dimension === dim).map((t) => t.key);
export const TERM_FIELDS = {
  categories: { type: "array", items: { type: "string", enum: termKeys("topic") } },
  audiences: { type: "array", items: { type: "string", enum: termKeys("audience") } },
  action_stages: { type: "array", items: { type: "string", enum: termKeys("stage") } },
};

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** The caller's DataSponge role (checked by the database with their own token), or null. */
export async function memberRole(authorization) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const r = await fetch(`${config.url}/rest/v1/rpc/fc_my_membership`, {
    method: "POST",
    headers: { apikey: config.key, Authorization: authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return null;
  const m = await r.json();
  return m?.active ? m.role : null;
}

/** Call a DataSponge RPC as the signed-in caller (their access rules apply), or anonymously. */
export async function rpc(fn, args, authorization = null) {
  const r = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.key, ...(authorization && { Authorization: authorization }), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || `DataSponge ${fn} failed (${r.status})`);
  return j;
}

/** Friendly message for an Anthropic API error, or null if it isn't one. */
export function aiError(err) {
  if (err instanceof Anthropic.RateLimitError) return [429, "The AI is busy right now. Try again in a minute."];
  if (err instanceof Anthropic.AuthenticationError) return [503, "The AI isn't set up correctly: the site's ANTHROPIC_API_KEY was rejected."];
  if (err instanceof Anthropic.APIError) return [502, `The AI request failed (${err.status ?? "network"}). Try again.`];
  return null;
}
