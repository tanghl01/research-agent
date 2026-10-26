# ECS Deployment

This directory deploys the current Operator Mastra/Next.js system to a single
ECS host. The current Singapore deployment SSH target is `47.84.225.120`.

## Shape

- Nginx proxies the public site to the local Next.js service. The deploy workflow
  installs an HTTP bootstrap config, requests Let's Encrypt certificates for
  `suanziai.com` and `www.suanziai.com`, then enables HTTPS with HTTP-to-HTTPS
  redirects for the public domains.
- `operator.service` runs the Next.js app from `/opt/operator` on
  `127.0.0.1:3000`.
- `operator-workers.service` runs the BullMQ workers for agent execution and
  run reconciliation. The deploy script installs local Redis and sets
  `REDIS_URL=redis://127.0.0.1:6379` when no external Redis URL is configured.
- `install-and-restart.sh` contains the host-side deployment logic used by the
  GitHub Actions workflow. Keep service setup, package installation, database
  bootstrap, storage configuration, and skill sync changes in that script rather
  than embedding large shell blocks directly in workflow YAML.
- Next.js serves the frontend and `/api/operator/*` route handlers. Those route
  handlers call `@operator/mastra-app` directly.
- The current ECS deployment is an internal beta: it runs `NODE_ENV=production`
  for optimized Next.js behavior and `OPERATOR_DEPLOYMENT_STAGE=staging` for
  product policy. Formal production should set `OPERATOR_DEPLOYMENT_STAGE=production`
  and use S3-compatible object storage.
- Mastra runs the configured main execution agent. The Singapore production
  deploy defaults to `codex-acp`, using the host-local Codex CLI authenticated
  with ChatGPT through ACP. When `OPERATOR_PACKY_API_KEY` is set, the deploy
  also enables `codex-acp-packycode` as the second fallback with an isolated
  Codex home at `/var/lib/operator/.codex-packycode`, and
  `claude-code-acp-packycode` as the third fallback through PackyCode's
  Anthropic-compatible endpoint.

## Runtime Paths

- App: `/opt/operator`
- Environment: `/etc/operator/operator.env`
- User data: `/var/lib/operator`
- Skill source cache: `/var/lib/operator/skills`
- Reusable runtime cache: `/var/lib/operator/runtimes`
- Local object storage: `/var/lib/operator/object-storage`
- Task workspaces: `/opt/operator/tmp/runs/web`

## Required Host State

- Ubuntu ECS with systemd. The deploy workflow installs Nginx, jq, and the
  Python matplotlib package required by research paper figure rendering when
  they are missing. It also installs and enables local Redis when `REDIS_URL`
  is not provided by deployment secrets or `/etc/operator/operator.env`.
- For HTTPS production traffic, DNS points `suanziai.com` and
  `www.suanziai.com` to the ECS host. The deploy workflow uses certbot webroot
  validation to maintain the certificate at `/etc/letsencrypt/live/suanziai.com`.
  Before DNS/cert migration, `ECS_PUBLIC_URL` can point at `http://47.84.225.120`.
- A `operator` Unix user owns `/opt/operator` and `/var/lib/operator`.
- Node.js 22+, npm, git, rsync, and pnpm 11.5.2 are installed. The GitHub
  Actions workflow can install or refresh Node.js and pnpm.
- Codex CLI has been logged in with ChatGPT on the host as `root`. The deploy
  workflow copies `/root/.codex/auth.json` to `/var/lib/operator/.codex/auth.json`
  on first deploy so the `operator` service user can run `codex-acp`.
- `/etc/operator/operator.env` contains any production secrets and model/provider
  settings. The deploy workflow creates it from `operator.env.example` when it is
  missing, but preserves server-local secret values on later deploys.
- External skill repositories are not rsynced from the app checkout. The deploy
  workflow syncs them on the host into `OPERATOR_SKILL_CACHE_ROOT`
  (`/var/lib/operator/skills` by default), then verifies the frontend
  `/api/operator/scopes` response has no unavailable skills. The deploy also
  syncs Operator capability receipts before restarting web and worker services.

## GitHub Actions Secrets

Set these on `chainstart/operator`:

- `ECS_SSH_HOST`: SSH target; for Singapore use `47.84.225.120`.
- `ECS_USER`: normally `root`.
- `ECS_SSH_PRIVATE_KEY`: private key allowed to SSH to the ECS host.

Optional:

- `ECS_HOST`: legacy alias used when `ECS_SSH_HOST` is not set.
- `ECS_PUBLIC_URL`: public verification base URL. Use
  `http://47.84.225.120` before DNS/HTTPS migration and
  `https://www.suanziai.com` after migration. The workflow defaults to
  `https://www.suanziai.com`.
- `OPERATOR_TLS_EMAIL`: optional Let's Encrypt account email for certificate
  expiry and renewal notices. If omitted, certbot registers without email.
- `ECS_PORT`: defaults to `22`.
- `ECS_APP_DIR`: defaults to `/opt/operator`.
- `OPERATOR_DEPLOYMENT_STAGE`: defaults to `staging` for the current internal
  beta. Use `production` only when production infrastructure such as S3 storage
  is configured.
- `OPERATOR_AGNES_API_KEY`, `OPERATOR_PACKY_API_KEY`,
  `OPERATOR_PACKY_BASE_URL`, `OPERATOR_PACKY_MODEL`,
  `OPERATOR_PACKY_ANTHROPIC_BASE_URL`, `OPERATOR_PACKY_CLAUDE_MODEL`,
  `OPERATOR_PACKY_IMAGE_API_KEY`, `OPERATOR_PACKY_IMAGE_BASE_URL`,
  `OPERATOR_PACKY_IMAGE_MODEL`, `OPERATOR_PACKY_IMAGE_QUALITY`,
  `OPERATOR_BRAVE_SEARCH_API_KEY`, `OPERATOR_TAVILY_API_KEY`,
  `OPERATOR_SERPER_API_KEY`, `OPERATOR_BING_SEARCH_API_KEY`, and
  `QINYAN_API_KEY`. When `QINYAN_API_KEY` is absent, the deploy skips the
  Qinyan academic skill collection instead of blocking web/worker deployment.
  `OPERATOR_PACKY_IMAGE_API_KEY` is required because `ppt-master` is a
  mandatory production skill; the text Packy API key is not used as an image API
  fallback because Packy groups can expose different model channels.
- Account backend and phone registration:
  `DATABASE_URL`, `OPERATOR_SESSION_SECRET`, `ALIYUN_ACCESS_KEY_ID` or
  `OPERATOR_ALIYUN_ACCESS_KEY_ID`, and `ALIYUN_ACCESS_KEY_SECRET` or
  `OPERATOR_ALIYUN_ACCESS_KEY_SECRET`.
- Redis queue and rate limiting:
  `REDIS_URL`. If omitted, the ECS deploy provisions local Redis at
  `redis://127.0.0.1:6379`.
- Optional Aliyun phone verification overrides:
  `OPERATOR_PHONE_LOGIN_PROVIDER`, `OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS`,
  `OPERATOR_ALIYUN_REGION_ID`, `OPERATOR_ALIYUN_DYPNS_ENDPOINT`,
  `OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM`, `OPERATOR_ALIYUN_DYPNS_CODE_LENGTH`,
  `OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS`, and
  `OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE`.
- Object storage overrides: `OPERATOR_STORAGE_PROVIDER`, `OPERATOR_STORAGE_ROOT`,
  `OPERATOR_STORAGE_ARTIFACT_BUCKET`, `OPERATOR_STORAGE_DRIVE_BUCKET`,
  `OPERATOR_STORAGE_CACHE_BUCKET`, `OPERATOR_S3_ENDPOINT`, `OPERATOR_S3_REGION`,
  `OPERATOR_S3_ACCESS_KEY_ID`, `OPERATOR_S3_SECRET_ACCESS_KEY`, and
  `OPERATOR_S3_FORCE_PATH_STYLE`. The ECS deploy uses local filesystem object
  storage at `/var/lib/operator/object-storage` for `staging` unless S3 settings
  are complete. Formal production requires S3-compatible storage unless
  `OPERATOR_ALLOW_LOCAL_OBJECT_STORAGE=true` is set as an emergency override.
- `CODEX_HTTPS_PROXY`: exported to `HTTPS_PROXY`, `HTTP_PROXY`, and
  `ALL_PROXY` when ECS egress needs a proxy.

## Manual Verification

```bash
curl -fsS http://47.84.225.120/healthz
curl -fsSI http://47.84.225.120/
curl -fsS http://47.84.225.120/api/operator/scopes
curl -fsS http://47.84.225.120/api/operator/backend/status \
  | jq -e '.backend.queueConfigured == true'
curl -fsSI https://www.suanziai.com/
curl -fsS https://www.suanziai.com/healthz
curl -fsS http://47.84.225.120/api/operator/scopes \
  | jq -e '[.catalog.skills[] | select(.available == false)] | length == 0'
ssh root@47.84.225.120 'systemctl is-active operator operator-workers redis-server'
```

For live agent tests, use the web UI after confirming the production
`/etc/operator/operator.env` has `OPERATOR_DEFAULT_AGENT_SCOPE=codex-acp`
and `OPERATOR_AGENT_FALLBACK_ORDER=codex-acp,codex-acp-packycode,claude-code-acp-packycode,...`.
Also confirm `sudo -u operator env HOME=/var/lib/operator CODEX_HOME=/var/lib/operator/.codex codex login status`
reports ChatGPT login. If PackyCode is enabled, verify
`/var/lib/operator/.codex-packycode/config.toml` exists and
`/var/lib/operator/.codex-packycode/auth.json` is readable only by `operator`.
