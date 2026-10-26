# Operator Self-Hosted Backend Runbook

## Local Bootstrap

The verified local setup uses a project-local PostgreSQL data directory and local filesystem object storage.

```bash
mkdir -p .local
printf '%s\n' 'operator-local-password' > .local/postgres.pw
/usr/lib/postgresql/16/bin/initdb \
  -D .local/postgres \
  -U operator \
  --pwfile=.local/postgres.pw \
  --auth-host=scram-sha-256 \
  --auth-local=trust

/usr/lib/postgresql/16/bin/pg_ctl \
  -D .local/postgres \
  -l .local/postgres.log \
  -o "-p 55432 -k /tmp -c listen_addresses=127.0.0.1" \
  start

createdb 'postgres://operator:operator-local-password@127.0.0.1:55432/postgres' operator
export DATABASE_URL=postgres://operator:operator-local-password@127.0.0.1:55432/operator
export OPERATOR_SESSION_SECRET=replace-with-at-least-24-random-characters
export OPERATOR_BACKEND_ENABLED=true
export OPERATOR_STORAGE_ROOT=tmp/object-storage
pnpm db:migrate
pnpm --filter @operator/web exec next dev --webpack --hostname 0.0.0.0 --port 3002
```

`OPERATOR_BACKEND_ENABLED=false` disables account-backed history and drive APIs while keeping local browser/workspace fallback available.

Stop the local database when needed:

```bash
/usr/lib/postgresql/16/bin/pg_ctl -D .local/postgres stop
```

## Storage

Local development can use the `@operator/storage` local FS adapter:

- artifact bucket: `OPERATOR_STORAGE_ARTIFACT_BUCKET`, default `operator-artifacts`
- drive bucket: `OPERATOR_STORAGE_DRIVE_BUCKET`, default `operator-drive`
- cache bucket: `OPERATOR_STORAGE_CACHE_BUCKET`, default `operator-cache`
- object root: `OPERATOR_STORAGE_ROOT`, default `tmp/object-storage`

Formal production should use the S3-compatible adapter:

```bash
export OPERATOR_STORAGE_PROVIDER=s3
export OPERATOR_S3_REGION=us-east-1
export OPERATOR_S3_ENDPOINT=        # optional for AWS S3, required for MinIO/R2-style endpoints
export OPERATOR_S3_ACCESS_KEY_ID=   # optional when IAM/default credentials are available
export OPERATOR_S3_SECRET_ACCESS_KEY=
export OPERATOR_S3_FORCE_PATH_STYLE=true
```

`NODE_ENV=production` controls optimized Next.js/runtime behavior. Product
deployment policy is controlled separately by `OPERATOR_DEPLOYMENT_STAGE`.
Development and single-host internal beta deployments (`development` or
`staging`) may use local filesystem storage. Formal production
(`OPERATOR_DEPLOYMENT_STAGE=production`) fails fast unless S3-compatible storage
is configured, except for explicit emergency override with
`OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE=true`.

## Workers

Production agent execution uses BullMQ workers instead of running long agent jobs
inside the Next.js request process. Run the web server and worker process
separately with the same `DATABASE_URL`, `REDIS_URL`, storage, identity, and ACP
runtime environment:

```bash
pnpm --filter @operator/web start
pnpm --filter @operator/web workers
```

The worker process listens to:

- `agent-run/run-agent` for main Codex/Claude/OpenHands ACP execution.
- `workflow-run/reconcile-run` for stale run reconciliation.

Local development defaults to in-process execution. To exercise production
behavior locally, set:

```bash
export REDIS_URL=redis://127.0.0.1:6379
export OPERATOR_AGENT_RUN_EXECUTION_MODE=queue
pnpm --filter @operator/web workers
```

## Database

Schema migrations live in `packages/db/migrations` and are generated from `packages/db/src/schema.ts`.

```bash
pnpm db:generate
pnpm db:migrate
```

Do not edit generated SQL casually after it has shipped. Add a new migration for production changes.

## Account Model

Production account entry can use a verified OIDC provider or the built-in phone
verification flow:

- Configure `OPERATOR_OIDC_ISSUER`, `OPERATOR_OIDC_AUDIENCE`, and `OPERATOR_OIDC_JWKS_URI`.
- Operator accepts a verified bearer token or `OPERATOR_OIDC_COOKIE_NAME` cookie and maps the OIDC subject into `user_identities`.
- Phone login stores one-time verification challenges in `phone_login_challenges` and maps verified phone numbers into `user_identities`.
- For Aliyun SMS authentication, set `OPERATOR_PHONE_LOGIN_PROVIDER=aliyun-dypns`, `ALIYUN_ACCESS_KEY_ID`, and `ALIYUN_ACCESS_KEY_SECRET`. Operator calls `SendSmsVerifyCode` and `CheckSmsVerifyCode` with Aliyun's official gifted signature/template.
- Configure `OPERATOR_SMS_WEBHOOK_URL` for production phone login. Without it, phone login codes are only returned in non-production debug mode.
- Operator local sessions use an opaque `operator_session` DB session token.
- Set `OPERATOR_REQUIRE_OIDC_IDENTITY=true` or `OPERATOR_IDENTITY_MODE=oidc` to fail closed when OIDC is required.
- `OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN=true` is only for trusted development deployments.

Email remains available as a safety binding on phone-based accounts. Use OIDC or a verified email provider before enabling email login outside trusted development.
