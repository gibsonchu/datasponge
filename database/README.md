# Supabase reference implementation

This is a pilot editorial catalog, not a canonical-document ingestion API yet. Apply `001` through `013` in order to a **new Supabase project** using migrations. Do not run the baseline on an existing DataSponge installation. Supabase Auth and the `pg_jsonschema` extension are required. The SQL installs its bundled draft schemas; the JSON files in `standards/` describe interchange documents.

Keep `fc_private` out of the Data API's exposed schemas. Only `public` is exposed. Public reads use `fc_records` and return reviewed standard documents. `fc_current_catalog` also excludes closed, historical, temporarily unavailable, and expired help listings. Raw catalog writes are denied. Drafts are scoped to authenticated members, and publication requires an editor or administrator.

Provision an initial scope and pending administrator membership through the database owner. `pending_memberships` takes an email, scope ID, role and expiration; inspect its definition in 001 before inserting. The Auth trigger enrolls the reserved address only after email confirmation. Never derive roles from user-editable metadata. No bootstrap operator, administrator address, or research seed is shipped in this repository.

`fc_propose` currently accepts the legacy editorial envelope plus a validated `standard_record`, not a standalone FRS/FMS/FSS document. The envelope includes review blockers, private research notes, taxonomy links and workflow fields. See its SQL signature and validation function before building an importer. `fc_review` supports publish, revise, exclude and archive with optimistic concurrency. Revisions are immutable. A future canonical-only ingestion adapter and editorial forms remain on the roadmap.

The static UI uses `site/config.json` for the URL and publishable key. Email-code sign-in requires a Supabase email template containing `{{ .Token }}`; configure delivery and test it in your own project. The UI never receives a service-role key. Sign-in establishes identity; only an invitation or reserved membership grants draft access.

Hosted media and coordinate publication are disabled in this pilot. Public relationships include only published targets. Database checks complement JSON Schema; schema validity does not establish factual accuracy, permission to reuse media, or current service availability.

## 006: status, audience, and the standard loader

- **Status** (`draft`, `published`, `hidden`, `excluded`) is kept on each record and follows review decisions. Editors relabel an unpublished record with `fc_private.set_unpublished_status`.
- **Audience** (`public` or `internal`) decides who may read a *published* record. Anonymous readers of `fc_catalog`, `fc_records`, and `fc_current_catalog` see only public records. Active members also see internal ones. Change it with `fc_private.set_audience`.
- **Verification is not overwritten on publication.** Each record keeps its own `verification` block, so an unreviewed record is never presented as reviewed.
- **`fc_private.propose_standard(doc, scope, audience, review_owner)`** accepts a standard FRS/FSS/FMS document and builds the editorial envelope that `propose` and the consistency triggers expect. Publication still goes through `fc_review`.
- The pilot's temporary research drafts were excluded, not deleted.

## 007: resident flood clips

- **Submitting:** anyone may submit a link to flood footage posted elsewhere (`public.fc_submit_clip`). Submissions wait in a private inbox (`fc_clip_inbox`, readable by members only) until an editor approves (`fc_approve_clip`) or rejects (`fc_reject_clip`) them. Approval builds and publishes a public FMS record marked `source_checked`.
- **Link-only media:** clips link to and embed the original post, credited to its creator. Nothing is copied or hosted.
- **Locations:** map points are published only for clips of streets, highways, and subways, rounded to a 0.0005° grid (about 50 m). The location guard now enforces this for every published record; exact points are never published. Clips of anywhere else get a neighborhood name only.
- **Removal:** anyone may ask for a published record to be taken down (`fc_request_removal`). Editors resolve requests with `fc_resolve_removal` (`remove` archives the record).

## 008: Editor entry points

- `fc_workspace_records`: every record in the caller's scope with its latest standard document, status, and audience.
- `fc_save_record(doc, target, audience, expected_revision)` saves a standard document and sets its status in one step. It refuses to overwrite a newer save (`expected_revision` is the revision the editor opened). Contributors can save drafts; only editors change what's public.
- `fc_import_records(items, filename)` saves many at once, all-or-nothing.
- `fc_set_record_status(record, published|draft|hidden|trash|restore)`, `fc_set_audience(record, public|internal)`.
- People (admins): `fc_members`, `fc_add_member(email, role)` (joins on first sign-in if they have no account yet), `fc_update_member`, `fc_remove_pending_member`.
- `fc_activity(max_rows)`: who did what, newest first.
- The pilot research drafts are marked `retired`, which keeps them out of the Editor; they stay in history.

## 010: availability note

FSS 0.1 gains an optional `service.availability_note`, a short plain-language detail about whether a service is taking people ("Waitlist until March"). Optional, so existing records stay valid.

## 011–012: Sources and Q/A

Answers (FRS `faq_answer` records, shown as **Q/A** in the Editor) now come from **Sources**: websites, PDFs, Word files, and images that members add.

- `fc_sources()`, `fc_add_sources(items)`: list and add sources (members). Files go in the public `sources` storage bucket; only members can upload.
- `fc_start_reading`, `fc_save_reading(source, title, publisher, summary, chunks, problem)`: editors save what `site/api/source-read.js` read, as searchable passages (`fc_private.source_chunks`, English full-text index).
- `fc_set_source_status(source, target)`: `waiting` (read again), `hidden` (kept, not searchable), `trashed`, `restore`.
- `fc_link_answer(record, source, quote)`: which sources back which Q/A, with the supporting quote.
- `fc_questions()`, `fc_add_questions(questions)`, `fc_set_question(...)`: questions waiting for an answer. `site/api/answer.js` answers them from Sources only.
- `fc_search_sources(q, max_results)`: public passage search over sources that have been read (all words first, then any). Flood Chat calls it when Q/A isn't specific enough. 012 makes it callable with the publishable key.
- 011 seeds Sources from the links the existing Q/A cite (except bluedots.nyc) and links them.

## 013: Stories

Neighborhood stories (an image plus a short text, tagged with place, when, who it's for, and purpose) move from the old Google Sheet into `fc_private.stories`. `story_no` is the stable number Flood Chat and the sheet's `ID` column use.

- `fc_stories()`: every story in the caller's scope (members), as JSON.
- `fc_save_stories(items, source)`: add or update stories, matched by `id`, else `story_no`, else added. Fields left out keep their values; all or nothing. Contributors save drafts; editors publish. A published story needs an image.
- `fc_set_story_status(story, target)`: `published`, `draft`, `hidden`, `trashed`, `restore`.
- `fc_published_stories()`: published stories, open to anyone (Flood Chat reads these).
- Public `stories` storage bucket for uploaded images; only members upload.

Choices and the sheet's columns are defined once in `site/editor/stories-model.js`, used by both the Editor's CSV upload and the one-time sheet import.
