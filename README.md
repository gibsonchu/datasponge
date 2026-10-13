# DataSponge

Open-source data infrastructure for flood resilience, founded and stewarded by **Floodline**.

DataSponge soaks up flood information from many sources (organizations, city programs, contractors, guides, resident footage) and keeps it in one shared, reviewed database. Everything FloodLine publishes reads from it:

| Uses DataSponge | What it shows |
|---|---|
| [Local Help](https://flooding-local-help.vercel.app) | Public services and quick answers |
| [Flood Clips](https://flood-clips.vercel.app) | Resident flood footage on a map |
| Flood Chat | The AI assistant, which can also use AI-only records |

**[DataSponge Editor](https://datasponge.floodline.nyc/editor/)** is where people update that data without touching code: add or edit a listing, publish or hide it, choose Public or AI-only, upload a spreadsheet, and review clips. A change published there appears on Local Help the next time someone loads the page.

The [DataSponge site](https://datasponge.floodline.nyc) explains the project and links to the editor. Developers can read the published catalog directly (see `site/config.json` for the endpoint and publishable key). DataSponge defines practical ways to organize, publish, and exchange flood information, and governments, researchers, community groups, and developers can implement the specifications independently.

## Three draft standards

| Specification | What it describes | Schema |
|---|---|---|
| **FRS 0.1** — Flood Resource Standard | Guidance, reports, research, regulations, documents, and information about assistance programs | [FRS schema](standards/frs.schema.json) |
| **FMS 0.1** — Flood Media Standard | Photographs, videos, maps, animations, and flood observations with no required media attachment | [FMS schema](standards/fms.schema.json) |
| **FSS 0.1** — Flood Services Standard | A provider's specific service offering, including coverage, eligibility, contact routes, and availability | [FSS schema](standards/fss.schema.json) |

These are **draft 0.1.0 schemas**, not stable 1.0 standards, accredited specifications, or claims of compatibility with MDS, CDS, DCAT, or HSDS. The OMF model inspires the separation between stewardship, open specifications, and products built on them; there is no affiliation.

## Start here

- [Plain-language data dictionary](docs/data-dictionary.md)
- [Three synthetic examples](standards/examples.json)
- [Shared architecture and interpretation](docs/architecture.md)
- [Contribution process](CONTRIBUTING.md)
- [Governance and versioning](GOVERNANCE.md)
- [Database implementation](database/README.md)
- [Project status and limitations](docs/status.md)

## Validate and run

Node.js 22+ and Python 3 are sufficient for the schema tests and static reference interface.

```sh
npm ci
npm test
npm run preview
```

Open `http://localhost:8080` for the About page and `http://localhost:8080/editor/` for the editor. Search, collection/place/topic filters, record details, JSON download, standards downloads, and the published catalog adapter are included.

To connect your own published catalog, configure `site/config.json` with a Supabase project URL and **publishable** key. Never put a secret/service-role key there. Read the database setup instructions first. This repository does not contain the steward's unreviewed 60-record research corpus, personal administrator enrollment, or credentials.

## Open specifications, managed contributions

Anyone may use the specifications, validators, or code under their licenses. To contribute standards changes, open an issue or pull request. To contribute data to Floodline's hosted catalog, contact Floodline and arrange membership; records are reviewed before publication. Other publishers can manage their own catalogs and editorial rules.

A document about a program belongs in FRS; a concrete service/intake offering belongs in FSS. A photograph or a resident's observation belongs in FMS. Link records explicitly rather than treating these different things as interchangeable.

## Licensing

Original code, JSON schemas, and synthetic examples are available under [MIT](LICENSE). Original prose documentation is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (attribute “DataSponge contributors”). Third-party records and media retain their own rights. No software or specification license here grants rights to reuse third-party photographs, videos, source documents, or logos.

## DataSponge Editor

`site/editor/` (served at `/editor/`; the old `/workspace` address redirects there) is where DataSponge members manage records:

- **Services** and **answers & resources**: add, edit, publish, draft, hide, trash and restore; choose **Public** (Local Help and the AI) or **AI-only**.
- **Upload CSV**: download a template or the current data, edit in Excel or Google Sheets, upload, check the preview, import (all-or-nothing).
- **Clip inbox** and **removal requests** for Flood Clips.
- **People** (admins): add colleagues by email and set their role (contributor saves drafts, editor publishes, admin manages people).
- **Activity**: who changed what.

Everyone signs in with their own account; the database's access rules decide what each person can do. The page uses only the publishable key in `site/config.json`.

Deploy the site with `npx vercel --prod` from `site/`.
