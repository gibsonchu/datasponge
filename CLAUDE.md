# CLAUDE.md

## Rules for every session (local, cloud, or started from Slack)

This is **DataSponge** (https://datasponge.floodline.nyc), a FloodLine site (owner: Gibson). Fixes usually come from bugs reported in Slack and approved by Gibson.

- **Deploys:** `main` is the production branch; every push to it deploys the live site. In cloud or Slack sessions, work on your own branch and let a pull request be opened for Gibson; don't push to `main` directly.
- **One fix per change.** Find the cause first, keep the change small, and don't refactor, restyle, or add copy, sections, or features nobody asked for. Mention ideas in your summary instead.
- **Check your work:** run the repo's build, typecheck, or tests if it has them. Say plainly if something couldn't be run.
- **Summary in plain words** (Gibson reviews on his phone): what was wrong, what changed, how you checked it, anything he needs to do.
- **Data:** never delete or rewrite production data, and never send emails or texts to real people while testing.
- **Secrets:** never commit `.env*` files, keys, or tokens, or print them.
- **Names:** the company is "FloodLine" (capital L) in text; addresses stay lowercase (floodline.nyc).

## About this repo

The site lives in `site/`. Its Supabase database is the source of truth for organizations, Q/A answers, sources, and stories that feed Blue Dots Urgent and Local Help, so a data or schema change affects those sites too.
