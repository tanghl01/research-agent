# Operator Knowledge Transfer Runbook

This runbook covers moving a completed Operator knowledge space from one host to another without re-crawling the source website.

## Scope

The transfer command is an internal operations tool, not a user-facing Operator capability. It lives in `packages/knowledge-ingestion` because it moves knowledge-domain database rows and object-storage files together.

Do not model it as a public skill or user tool in the capability layer. A future admin console can wrap the same module behind owner-only access, but the MVP control surface is the CLI.

## What Transfers

The bundle contains:

- `manifest.json`: schema version, counts, object checksums, and object mapping.
- `data.json`: rows for `knowledge_spaces`, `knowledge_sources`, `knowledge_ingestion_runs`, `knowledge_items`, `knowledge_item_versions`, `knowledge_chunks`, `knowledge_templates`, `knowledge_archive_members`, and referenced `file_assets`.
- `pages.jsonl`: text-only page records with URL, title, source URL, content type, normalized text, and metadata.
- `objects/`: object-storage payloads referenced by `file_assets`. These should be attachments and other non-HTML original files, not raw page HTML.

The Crawlee runtime directory `storage/` is not part of the bundle. It is only a crawler queue/cache and should not be uploaded as the production knowledge base.

## HTML Page Storage

HTML pages are text-only knowledge records. They should write `knowledge_items`, `knowledge_item_versions`, and `knowledge_chunks`, but should not create `file_assets` or object-storage files. Original file storage is reserved for downloadable resources such as PDF, Word, Excel, PowerPoint, ZIP, and RAR files.

If old runs stored raw HTML in object storage, clean them before exporting:

```bash
DATABASE_URL='postgres://...' \
OPERATOR_STORAGE_ROOT='tmp/object-storage' \
pnpm knowledge:cleanup-html -- --space dianji --dry-run

DATABASE_URL='postgres://...' \
OPERATOR_STORAGE_ROOT='tmp/object-storage' \
pnpm knowledge:cleanup-html -- --space dianji
```

## Export

Run this after crawl and ingestion have completed and `knowledge_items` / `file_assets` are populated:

```bash
DATABASE_URL='postgres://...' \
OPERATOR_STORAGE_ROOT='tmp/object-storage' \
pnpm knowledge:export -- --space dianji --out tmp/knowledge-bundles/dianji --overwrite
```

For S3-compatible storage, configure:

```bash
OPERATOR_STORAGE_PROVIDER=s3
OPERATOR_S3_REGION=...
OPERATOR_S3_ENDPOINT=...
OPERATOR_S3_ACCESS_KEY_ID=...
OPERATOR_S3_SECRET_ACCESS_KEY=...
OPERATOR_STORAGE_KNOWLEDGE_BUCKET=operator-knowledge
```

## Import

Copy the exported bundle directory to the target host, run migrations first, then import:

```bash
DATABASE_URL='postgres://...' \
OPERATOR_STORAGE_ROOT='tmp/object-storage' \
pnpm knowledge:import -- --bundle tmp/knowledge-bundles/dianji
```

If the target host uses a different knowledge bucket:

```bash
pnpm knowledge:import -- --bundle tmp/knowledge-bundles/dianji --bucket production-knowledge
```

The importer writes objects to the target storage provider and records `file_assets.storage_provider` / `file_assets.bucket` for that target.

## Operational Notes

- Import into an empty or matching knowledge space first. If a production `dianji` space already exists with different IDs, decide whether to clear it or build an ID remapping migration.
- The command is idempotent for rows with the same primary IDs; existing rows are skipped.
- `created_by` fields are nulled on import because user IDs are environment-specific.
- Check `manifest.json` counts before and after import.
- Check `pages.jsonl` if you need to inspect page text outside Postgres.
