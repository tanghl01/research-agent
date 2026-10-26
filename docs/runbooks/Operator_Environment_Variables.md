# Operator Environment Variables

This is the central reference for Operator runtime configuration. Keep secrets in
local `.env` files, deployment secret stores, or systemd environment overrides;
do not commit real tokens or keys.

## Source Files

- `.env.example`: local development baseline.
- `deploy/ecs/operator.env.example`: production ECS baseline.
- `docs/runbooks/Operator_Self_Hosted_Backend_Runbook.md`: local backend bootstrap steps.

## App Runtime

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | Production | `production` for deployed Next.js/runtime behavior. |
| `OPERATOR_DEPLOYMENT_STAGE` | Deployment | Product deployment stage: `development`, `staging`, or `production`. Use `staging` for internal beta deployments that run optimized Next.js but are not formal production. |
| `OPERATOR_REPO_ROOT` | Production | Absolute path to the Operator repository when runtime code cannot infer it. |
| `OPERATOR_WEB_HOST` | ECS | Host passed to `next start`; usually `127.0.0.1` behind a proxy. |
| `OPERATOR_WEB_PORT` | ECS | Port passed to `next start`; default examples use `3000`. |
| `GITHUB_SHA` | Optional | Health endpoint version marker. |
| `OPERATOR_DEPLOYED_GIT_COMMIT` | Optional | Health endpoint version marker when `GITHUB_SHA` is unavailable. |

## Backend, Identity, And Queue

| Variable | Required | Description |
| --- | --- | --- |
| `OPERATOR_BACKEND_ENABLED` | Optional | Forces account-backed backend on/off. If unset, backend enables when `DATABASE_URL` is present. |
| `DATABASE_URL` | Backend | PostgreSQL connection string for DB, migrations, sessions, tasks, drive, and artifacts. |
| `OPERATOR_SESSION_SECRET` | Backend or local login | Secret used to hash local phone/email verification data; must be at least 24 characters. The `operator_session` browser cookie is an opaque DB session token. |
| `OPERATOR_OIDC_ISSUER` | Production identity | Verified OIDC issuer. |
| `OPERATOR_OIDC_AUDIENCE` | Production identity | Accepted OIDC audience value or CSV list. |
| `OPERATOR_OIDC_JWKS_URI` | Production identity | JWKS URL used to verify OIDC tokens. |
| `OPERATOR_OIDC_COOKIE_NAME` | Optional | Cookie name for OIDC identity token; default is `operator_identity_token`. |
| `OPERATOR_OIDC_DEFAULT_TTL_SECONDS` | Optional | Default TTL for OIDC-derived sessions. |
| `OPERATOR_REQUIRE_OIDC_IDENTITY` | Optional | Set `true` to fail closed when no verified OIDC identity is present. |
| `OPERATOR_IDENTITY_MODE` | Optional | Set `oidc` as an alias for requiring OIDC identity. |
| `OPERATOR_TRUST_PROXY_HEADERS` | Proxy deployments | Set `true` only when the app is behind a trusted proxy that strips client-supplied `x-forwarded-*` headers. |
| `OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN` | Dev only | Enables email-only login without verified identity. Use only in trusted development. |
| `OPERATOR_ALLOW_LEGACY_LOCAL_TASK_ACCESS` | Dev/migration only | Allows `source=browser-local` API reads from legacy local `tmp/runs` task files even when the account backend is enabled. Keep unset or `false` in production. |
| `OPERATOR_PHONE_LOGIN_PROVIDER` | Optional | Phone login delivery/check provider: `aliyun-dypns`, `webhook`, or `debug`. Defaults to Aliyun when Aliyun variables are complete, then webhook, then debug outside production. |
| `OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS` | Optional | Phone login verification code TTL, clamped between 60 and 1800 seconds. |
| `OPERATOR_PHONE_LOGIN_DEBUG_CODE` | Dev only | Returns the generated phone login code from the API in non-production unless set to `false`. |
| `OPERATOR_SMS_WEBHOOK_URL` | Production phone login | HTTPS endpoint that receives `{ type, phone, code, expiresAt }` for SMS delivery. Required for production phone login. |
| `OPERATOR_SMS_WEBHOOK_TOKEN` | Optional | Bearer token sent to `OPERATOR_SMS_WEBHOOK_URL`. |
| `ALIYUN_ACCESS_KEY_ID` / `OPERATOR_ALIYUN_ACCESS_KEY_ID` | Aliyun phone login | RAM AccessKey ID for Aliyun Phone Number Verification Service. |
| `ALIYUN_ACCESS_KEY_SECRET` / `OPERATOR_ALIYUN_ACCESS_KEY_SECRET` | Aliyun phone login | RAM AccessKey secret. Store only in secret manager or local ignored env files. |
| `OPERATOR_ALIYUN_REGION_ID` | Aliyun phone login | Aliyun region ID; default examples use `cn-hangzhou`. |
| `OPERATOR_ALIYUN_DYPNS_ENDPOINT` | Aliyun phone login | API endpoint; default examples use `dypnsapi.aliyuncs.com`. |
| `OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM` | Aliyun phone login | JSON template variables. Use single quotes in `.env` files, for example `'{"code":"##code##","min":"10"}'`, so dotenv does not treat `#` as a comment. The official gifted signature/template are built in: `速通互联验证码` / `100001`. |
| `OPERATOR_ALIYUN_DYPNS_CODE_LENGTH` | Optional | Aliyun-generated code length, 4 to 8 digits. |
| `OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS` | Optional | Minimum resend interval sent to Aliyun. |
| `OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE` | Dev only | Requests Aliyun to return the generated code. Keep `false` in production. |
| `REDIS_URL` | Production required | BullMQ queue and production rate limiting Redis connection. Production job queues/workers fail fast when this is missing. |
| `OPERATOR_ALLOW_LOCAL_TASK_EVENT_BUS` | Dev/test only | Allows in-memory AG-UI task event fanout without Redis. Keep unset in production; production task event SSE fails fast when `REDIS_URL` is missing. |
| `OPERATOR_ALLOW_DISABLED_QUEUE` | Dev/test only | Allows `DisabledJobQueue` without Redis. Keep unset in production. |
| `OPERATOR_ALLOW_MEMORY_RATE_LIMITER` | Dev/test only | Allows in-memory API rate limiting without Redis. Keep unset in production. |
| `OPERATOR_AGENT_RUN_EXECUTION_MODE` | Optional | `queue`/`bullmq` or `in-process`. Production defaults to `queue`; local development defaults to `in-process`. |
| `OPERATOR_ALLOW_IN_PROCESS_AGENT_RUN` | Emergency production bypass | Set `true` only for controlled production debugging when no worker is available. |
| `OPERATOR_AGENT_RUN_QUEUE_WAIT_MS` | Optional | Maximum time the chat request waits for the BullMQ `run-agent` worker result. |
| `OPERATOR_OWNER_EMAIL` | Seed script | Initial owner email for DB seed helpers. |
| `OPERATOR_OWNER_NAME` | Seed script | Initial owner display name for DB seed helpers. |

## Storage

| Variable | Required | Description |
| --- | --- | --- |
| `OPERATOR_STORAGE_PROVIDER` | Optional | `local` or `s3`; formal production (`OPERATOR_DEPLOYMENT_STAGE=production`) requires `s3` unless `OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE=true`. |
| `OPERATOR_STORAGE_ROOT` | Local storage | Local filesystem object-store root, defaulting to `tmp/object-storage` in local docs and `/var/lib/operator/object-storage` in ECS internal beta. Use only for development or single-host staging. |
| `OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE` | Emergency only | Allows local filesystem object storage in formal production. Keep unset for cloud/multi-instance deployments. |
| `OPERATOR_STORAGE_ARTIFACT_BUCKET` | Backend | Artifact bucket name; default example is `operator-artifacts`. |
| `OPERATOR_STORAGE_DRIVE_BUCKET` | Backend | User drive bucket name; default example is `operator-drive`. |
| `OPERATOR_STORAGE_CACHE_BUCKET` | Backend | Runtime cache bucket name; default example is `operator-cache`. |
| `OPERATOR_S3_ENDPOINT` | S3-compatible storage | Custom S3 endpoint for MinIO, R2, or equivalent. |
| `OPERATOR_S3_REGION` | S3 storage | S3 region. Required when S3 storage is enabled. |
| `OPERATOR_S3_ACCESS_KEY_ID` | Optional | S3 access key. Can be omitted when IAM/default credentials are available. |
| `OPERATOR_S3_SECRET_ACCESS_KEY` | Optional | S3 secret key. Must be configured together with access key. |
| `OPERATOR_S3_FORCE_PATH_STYLE` | Optional | Forces path-style S3 addressing; useful for MinIO/R2-style endpoints. |

## Agent Selection

| Variable | Required | Description |
| --- | --- | --- |
| `OPERATOR_DEFAULT_AGENT_SCOPE` | Runtime | Main execution scope id. Current Singapore production default is `codex-acp`. |
| `OPERATOR_DEFAULT_AGENT_ID` | Legacy | Backward-compatible alias for default agent id. |
| `OPERATOR_AGENT_FALLBACK_ORDER` | Runtime | Comma-separated fallback order, for example `codex-acp,codex-acp-packycode,claude-code-acp-packycode,claude-code-acp,openhands-acp`. |
| `OPERATOR_ACP_AGENT_FALLBACK_ORDER` | Legacy | Backward-compatible alias for fallback order. |
| `OPERATOR_MASTRA_AGENT_TIMEOUT_SECONDS` | Runtime | Shared agent attempt timeout. |
| `OPERATOR_MASTRA_SANDBOX_TIMEOUT_SECONDS` | Runtime | Mastra workspace/sandbox timeout. |

## ACP Runtimes

Use `OPERATOR_MASTRA_ACP_AGENTS_JSON` for multiple runtime definitions. The older
`OPERATOR_ACP_AGENTS_JSON` is still read for compatibility.

Convenience single-runtime prefixes currently supported:

- `OPERATOR_CODEX_ACP`
- `OPERATOR_CODEX_ACP_PACKYCODE`
- `OPERATOR_CLAUDE_CODE_ACP_PACKYCODE`
- `OPERATOR_CLAUDE_CODE_ACP`
- `OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP`
- `OPERATOR_OPENHANDS_ACP`

For each prefix, these suffixes are available:

| Suffix | Description |
| --- | --- |
| `_COMMAND` | Executable command. Runtime registers only when this is set. |
| `_ARGS` | Command args, either shell-style string or JSON array. |
| `_MODEL` | Optional ACP model value. Leave empty when the wrapped runtime controls its own model. |
| `_CWD` | Working directory. Use `OPERATOR_REPO_ROOT` for repo-local skills. |
| `_ENV` | JSON object of environment variables passed to the runtime. |
| `_PERSIST_SESSION` | Whether the ACP session should persist across tasks. |
| `_ID`, `_NAME`, `_DESCRIPTION`, `_KEYWORDS` | Optional scope metadata overrides. |

Provider keys used by current examples:

| Variable | Description |
| --- | --- |
| `CODEX_HOME` | Optional Codex CLI config/cache home used by `codex-acp`. |
| `OPERATOR_CODEX_CLI_DEFAULT_MODEL` | Optional default model reused by `codex-acp` when `OPERATOR_CODEX_ACP_MODEL` is empty. |
| `OPERATOR_AGNES_API_KEY` | Agnes provider key. Current examples use it for Claude Code ACP through an Anthropic-compatible local proxy and for OpenHands ACP through OpenAI-compatible env vars. |
| `OPERATOR_DEEPSEEK_API_KEY` | DeepSeek key used by the Claude Code DeepSeek ACP fallback. |
| `OPERATOR_PACKY_API_KEY` | PackyCode API key used by the `codex-acp-packycode` fallback. |
| `OPERATOR_PACKY_BASE_URL` | PackyCode OpenAI-compatible base URL. Defaults to `https://www.packyapi.com/v1`. |
| `OPERATOR_PACKY_MODEL` | PackyCode Codex model. Defaults to `gpt-5.5`. |
| `OPERATOR_PACKY_ANTHROPIC_BASE_URL` | PackyCode Anthropic-compatible base URL for Claude Code ACP. Defaults to `https://www.packyapi.com`. |
| `OPERATOR_PACKY_CLAUDE_MODEL` | PackyCode Claude model. Defaults to `claude-opus-4-8`. |
| `OPERATOR_PACKY_IMAGE_API_KEY` | Packy image-generation key used by PPT Master runtime command `image_gen`. It is mapped to `OPENAI_API_KEY` only inside that child process. |
| `OPERATOR_PACKY_IMAGE_BASE_URL` | Packy OpenAI-compatible image base URL for PPT Master. Defaults to `https://www.packyapi.com/v1`. |
| `OPERATOR_PACKY_IMAGE_MODEL` | Packy image model for PPT Master. Defaults to `gpt-image-2`. |
| `OPERATOR_PACKY_IMAGE_QUALITY` | Optional PPT Master image quality override. Defaults to `low` for quick MVP generation tests. |

Do not export direct global `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY` for Operator services. Configure provider credentials through `OPERATOR_*` variables and let the relevant ACP or skill runtime adapter map them into provider-specific names for the child process.

## Web And Search Tools

| Variable | Description |
| --- | --- |
| `OPERATOR_BRAVE_SEARCH_API_KEY` / `BRAVE_SEARCH_API_KEY` | Brave Search tool key. |
| `OPERATOR_TAVILY_API_KEY` / `TAVILY_API_KEY` | Tavily Search tool key. |
| `OPERATOR_SERPER_API_KEY` / `SERPER_API_KEY` | Serper Search tool key. |
| `OPERATOR_BING_SEARCH_API_KEY` / `BING_SEARCH_API_KEY` | Bing Search tool key. |
| `OPERATOR_WEB_FETCH_TIMEOUT_SECONDS` | Web fetch/download timeout. |
| `OPERATOR_WEB_DOWNLOAD_MAX_BYTES` | Maximum download size for web fetch tools. |
| `OPERATOR_WEB_USER_AGENT` | User agent for web fetch tools. |

## Observability

| Variable | Description |
| --- | --- |
| `OPERATOR_OTEL_DISABLED` | Set to `true` to skip the Next.js OpenTelemetry bootstrap. |
| `OTEL_SERVICE_NAME` | OpenTelemetry service name; defaults to `operator-web`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP HTTP endpoint used by the OpenTelemetry SDK when the trace-specific endpoint is not set. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Trace-specific OTLP HTTP endpoint. Takes precedence over `OTEL_EXPORTER_OTLP_ENDPOINT`. |

## Skills And Workspaces

| Variable | Description |
| --- | --- |
| `OPERATOR_SKILL_MANIFEST_DIR` | Override skill manifest directory. |
| `OPERATOR_MASTRA_SKILLS_ROOT` | Root for Mastra workspace skills. |
| `OPERATOR_SKILL_CACHE_ROOT` | Production skill cache root. |
| `OPERATOR_RUNTIME_CACHE_ROOT` | Shared dependency/runtime cache root. |
| `OPERATOR_PIP_CACHE_DIR` | Shared pip download/build cache for skill venv installation. Defaults to `OPERATOR_RUNTIME_CACHE_ROOT/_pip-cache`; the installer exports it as `PIP_CACHE_DIR`. |
| `OPERATOR_CAPABILITY_MANIFEST_DIR` | Override capability package manifest directory. Defaults to `capabilities/manifests`. |
| `OPERATOR_CAPABILITY_INSTALL_STATE_ROOT` | Capability lifecycle receipt root for skills, workflows, agents, tools, and packages. Defaults to `OPERATOR_RUNTIME_CACHE_ROOT/_capability-installs`. Runtime availability must pass install, configuration, validation, registration, deployment, and enablement gates implemented by the adapter. |
| `OPERATOR_SYSTEM_PYTHON` | Python executable for skill runtime setup. |
| `PYTHON` | Python executable used by validation helpers when `OPERATOR_SYSTEM_PYTHON` is not involved. |
| `OPERATOR_SKILL2WORKFLOW_CODEX_TIMEOUT_MS` | Timeout for skill-to-workflow Codex conversion. |
| `OPERATOR_SKILL2WORKFLOW_ORIGINAL_TEST_TIMEOUT_MS` | Timeout for original skill test command during conversion. |

Skill manifests can also declare root override env vars such as
`OPERATOR_GORDEN_PPT_SKILL_ROOT`, `OPERATOR_GUIZANG_PPT_SKILL_ROOT`,
`OPERATOR_PPT_MASTER_SKILL_ROOT`, `OPERATOR_SCIENTIFIC_AGENT_SKILLS_ROOT`,
`OPERATOR_TEXT_TO_CAD_ROOT`, `OPERATOR_CLAUDE_FOR_LEGAL_ROOT`, and
`OPERATOR_BIOMNI_ROOT`.

Relative Operator skill/cache paths are resolved against `OPERATOR_REPO_ROOT`
or the detected monorepo root, not against the current process working directory.

`pnpm capabilities:sync --kind skill` is the only skill installation entrypoint.
Configured ACP agents must also pass the same lifecycle with
`pnpm capabilities:sync --all --kind agent` or `pnpm capabilities:sync <agent-id>
--kind agent` before they are visible to runtime fallback.
Capability packages that declare model/API/provider-backed features must declare
complete required configuration and pass required capability tests before they are
visible to users.

## Development And Tests

| Variable | Description |
| --- | --- |
| `OPERATOR_RUN_PPT_INTEGRATION` | Enables PPT integration tests that are skipped by default. |
| `OPERATOR_WEB_E2E_PORT` | Playwright dev server port. |
| `OPERATOR_CAPTURE_URL` | Demo capture script target URL. |
| `CI` | Playwright/Next test environment flag. |
