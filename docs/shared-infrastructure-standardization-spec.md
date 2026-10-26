# Shared Infrastructure Standardization Spec

## Objective

Operator-specific product behavior remains owned by this repository: Mastra/ACP orchestration, task history, artifact registration, Drive product semantics, scope catalogs, and agent traces.

All mature shared infrastructure must use industry-standard protocols, libraries, and operational interfaces instead of project-local placeholders or one-off implementations. This reduces security risk in account handling, file storage, background jobs, and cross-cutting API controls.

## Scope

### Identity and Account Entry

Production identity must be based on a verified external identity provider using standard OIDC/JWT semantics.

Requirements:

- Add a standard OIDC JWT identity provider based on JWKS verification.
- Accept verified identity from `Authorization: Bearer <jwt>` or a configured identity cookie.
- Verify issuer, audience, signature, expiry, and subject before mapping to a Operator user.
- Keep local unverified email login only as a development escape hatch behind `OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN`.
- Continue supporting Operator guest sessions as a Operator-specific onboarding feature, but do not treat guest or unverified email login as production account security.

Out of scope:

- Choosing a hosted identity vendor.
- Building an email/SMS OTP delivery product in this repository.

### Session Cookies

Session cookie serialization/parsing must use a maintained cookie library. Operator may keep its signed DB-backed guest session format, but cookie header creation and parsing must not be ad hoc string assembly.

Requirements:

- Use standard cookie serialize/parse helpers.
- Preserve `HttpOnly`, `SameSite=Lax`, `Path=/`, and production `Secure`.
- Keep token hashing in the database.

### Object Storage

Formal production object storage must use S3-compatible APIs. Development and
single-host internal beta deployments may use the local filesystem adapter.

Requirements:

- Implement `S3CompatibleStorageAdapter` with AWS SDK commands.
- Support put/get/stat/delete/presigned download URL.
- Select S3 when `OPERATOR_STORAGE_PROVIDER=s3` or S3 endpoint configuration is present.
- Keep local filesystem storage only as a development or single-host staging adapter.
- Keep artifact and Drive metadata in Postgres while file bytes are stored through the object storage adapter.

### Background Jobs

Background job interfaces must use BullMQ over Redis for production.

Requirements:

- Replace Redis placeholder with a concrete BullMQ-backed queue adapter.
- Keep disabled queue only for explicit development/test mode.
- Return stable job metadata from enqueue calls.

### API Validation and Cross-Cutting Security

Web route parsing and security controls must use shared helpers and standard libraries.

Requirements:

- Use schema validation for JSON request bodies.
- Add same-origin/CSRF protection for cookie-authenticated mutations.
- Add rate limiting for login and sensitive mutation endpoints.
- Add standard security headers through Next config.

### Database

Postgres and Drizzle remain the standard database stack.

Requirements:

- Keep Drizzle schema and migrations.
- Do not introduce raw SQL for routine CRUD unless Drizzle cannot express the query safely.
- Production runtime must require `DATABASE_URL`; local migration tooling may keep an explicit local default.

## Acceptance Criteria

- OIDC JWT verification exists in `@operator/identity` and is wired into web session resolution.
- Cookie handling uses a maintained cookie package.
- S3-compatible storage adapter is implemented and selected by configuration.
- BullMQ Redis queue adapter is implemented.
- Sensitive JSON routes use shared validation helpers.
- Login and admin mutation routes have rate limiting and same-origin checks.
- Next.js emits baseline security headers.
- Unit tests cover the new identity, storage, queue, config, and API security helpers.
- `pnpm --filter @operator/identity test`
- `pnpm --filter @operator/storage test`
- `pnpm --filter @operator/queue test`
- `pnpm --filter @operator/web test`
- `pnpm --filter @operator/web typecheck`

## Residual Product Decisions

The repository can provide standard integration points, but deployment must still choose real production services:

- OIDC provider: Auth0, Keycloak, Cognito, Zitadel, Ory, enterprise IdP, or equivalent.
- Object storage: AWS S3, Cloudflare R2, MinIO, or another S3-compatible service.
- Redis queue backend: managed Redis or self-hosted Redis reachable by BullMQ workers.
- Secret management: deployment platform secret store or KMS-backed injection.
