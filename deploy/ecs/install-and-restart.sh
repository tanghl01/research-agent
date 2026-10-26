#!/usr/bin/env bash
# Runs on the ECS host. GitHub Actions passes OPERATOR_DEPLOY_ENV_B64 and
# streams this script over SSH from .github/workflows/deploy-ecs.yml.
set -euo pipefail
eval "$(
  python3 - <<'PY'
import base64
import json
import os
import shlex

keys = [
    "ECS_APP_DIR",
    "GITHUB_SHA",
    "OPERATOR_DEPLOYMENT_STAGE",
    "OPERATOR_TLS_EMAIL",
    "CODEX_HTTPS_PROXY",
    "OPERATOR_AGNES_API_KEY",
    "OPERATOR_DEEPSEEK_API_KEY",
    "OPERATOR_PACKY_API_KEY",
    "OPERATOR_PACKY_BASE_URL",
    "OPERATOR_PACKY_MODEL",
    "OPERATOR_PACKY_ANTHROPIC_BASE_URL",
    "OPERATOR_PACKY_CLAUDE_MODEL",
    "OPERATOR_PACKY_IMAGE_API_KEY",
    "OPERATOR_PACKY_IMAGE_BASE_URL",
    "OPERATOR_PACKY_IMAGE_MODEL",
    "OPERATOR_PACKY_IMAGE_QUALITY",
    "QINYAN_API_KEY",
    "OPERATOR_BRAVE_SEARCH_API_KEY",
    "OPERATOR_TAVILY_API_KEY",
    "OPERATOR_SERPER_API_KEY",
    "OPERATOR_BING_SEARCH_API_KEY",
    "DATABASE_URL",
    "OPERATOR_SESSION_SECRET",
    "OPERATOR_PHONE_LOGIN_PROVIDER",
    "OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS",
    "ALIYUN_ACCESS_KEY_ID",
    "ALIYUN_ACCESS_KEY_SECRET",
    "OPERATOR_ALIYUN_ACCESS_KEY_ID",
    "OPERATOR_ALIYUN_ACCESS_KEY_SECRET",
    "OPERATOR_ALIYUN_REGION_ID",
    "OPERATOR_ALIYUN_DYPNS_ENDPOINT",
    "OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM",
    "OPERATOR_ALIYUN_DYPNS_CODE_LENGTH",
    "OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS",
    "OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE",
    "OPERATOR_STORAGE_PROVIDER",
    "OPERATOR_STORAGE_ROOT",
    "OPERATOR_STORAGE_ARTIFACT_BUCKET",
    "OPERATOR_STORAGE_DRIVE_BUCKET",
    "OPERATOR_STORAGE_CACHE_BUCKET",
    "OPERATOR_S3_ENDPOINT",
    "OPERATOR_S3_REGION",
    "OPERATOR_S3_ACCESS_KEY_ID",
    "OPERATOR_S3_SECRET_ACCESS_KEY",
    "OPERATOR_S3_FORCE_PATH_STYLE",
    "REDIS_URL",
]
payload = json.loads(base64.b64decode(os.environ["OPERATOR_DEPLOY_ENV_B64"]).decode("utf-8"))
for key in keys:
    print(f"{key}={shlex.quote(str(payload.get(key, '')))}")
PY
)"
cd "$ECS_APP_DIR"

operator_tls_cert_name=suanziai.com
operator_tls_domains=(suanziai.com www.suanziai.com)
operator_tls_cert_dir="/etc/letsencrypt/live/$operator_tls_cert_name"

node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
if [ "$node_major" -lt 22 ]; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version 2>/dev/null || true)" != "11.5.2" ]; then
  timeout --kill-after=30s 5m npm install -g pnpm@11.5.2 --no-audit --no-fund
fi
if ! command -v xelatex >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends \
    texlive-xetex \
    texlive-lang-chinese \
    texlive-latex-extra \
    texlive-fonts-recommended
fi
if ! python3 -c 'import matplotlib' >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends python3-matplotlib
fi
ensure_python_venv() {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  if python3 -m venv "$tmp_dir/venv" >/dev/null 2>&1; then
    rm -rf "$tmp_dir"
    return 0
  fi
  rm -rf "$tmp_dir"
  apt-get update
  apt-get install -y --no-install-recommends python3-venv
}
ensure_python_venv
if ! command -v nginx >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx jq certbot
fi
xelatex --version
python3 -c 'import matplotlib; print(matplotlib.__version__)'
install -d -m 755 -o operator -g operator /var/lib/operator/npm-global
install -d -m 755 -o operator -g operator /var/lib/operator/.npm
install -d -m 750 -o operator -g operator /var/lib/operator/.codex

if [ ! -f /var/lib/operator/.codex/auth.json ]; then
  if [ -f /root/.codex/auth.json ]; then
    install -m 600 -o operator -g operator /root/.codex/auth.json /var/lib/operator/.codex/auth.json
  else
    printf '%s\n' "Missing Codex ChatGPT auth cache. Run 'codex login --device-auth' on the ECS host as root before deploying codex-acp." >&2
    exit 1
  fi
fi

cleanup_agent_npm_temps() {
  rm -rf \
    /var/lib/operator/npm-global/lib/node_modules/@openai/.codex-* \
    /var/lib/operator/npm-global/lib/node_modules/@agentclientprotocol/.codex-acp-* \
    /var/lib/operator/npm-global/lib/node_modules/.opencode-ai-* \
    /var/lib/operator/npm-global/lib/node_modules/.opencode-* \
    /var/lib/operator/npm-global/bin/.codex-* \
    /var/lib/operator/npm-global/bin/.codex-acp-* \
    /var/lib/operator/npm-global/bin/.opencode-*
}

operator_npm_env() {
  sudo -u operator env \
    HOME=/var/lib/operator \
    PATH=/var/lib/operator/npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    npm_config_prefix=/var/lib/operator/npm-global \
    npm_config_cache=/var/lib/operator/.npm \
    npm_config_fetch_timeout=120000 \
    npm_config_fetch_retries=2 \
    "$@"
}

operator_npm_timeout() {
  local limit="$1"
  shift
  timeout --kill-after=30s "$limit" sudo -u operator env \
    HOME=/var/lib/operator \
    PATH=/var/lib/operator/npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    npm_config_prefix=/var/lib/operator/npm-global \
    npm_config_cache=/var/lib/operator/.npm \
    npm_config_fetch_timeout=120000 \
    npm_config_fetch_retries=2 \
    "$@"
}

operator_package_version() {
  local package="$1"
  operator_npm_env npm list -g --depth=0 --json "$package" 2>/dev/null | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      try {
        const name = process.argv[1];
        const data = JSON.parse(input);
        const version = data.dependencies?.[name]?.version;
        if (version) process.stdout.write(version);
      } catch {}
    });
  ' "$package"
}

operator_command_exists() {
  local command_name="$1"
  sudo -u operator env \
    HOME=/var/lib/operator \
    PATH=/var/lib/operator/npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    bash -lc "command -v '$command_name' >/dev/null 2>&1"
}

ensure_agent_cli_package() {
  local package="$1"
  local command_name="$2"
  local current_version latest_version
  current_version="$(operator_package_version "$package" || true)"
  latest_version="$(operator_npm_timeout 90s npm view "$package" version 2>/dev/null || true)"
  if [ -n "$current_version" ] && operator_command_exists "$command_name"; then
    if [ -z "$latest_version" ] || [ "$current_version" = "$latest_version" ]; then
      printf '%s@%s already installed\n' "$package" "$current_version"
      return 0
    fi
    printf 'Updating %s from %s to %s\n' "$package" "$current_version" "$latest_version"
  else
    printf 'Installing %s\n' "$package"
  fi

  for attempt in 1 2; do
    cleanup_agent_npm_temps
    if operator_npm_timeout 5m npm install -g --no-audit --no-fund "$package@latest"; then
      return 0
    fi
    sleep "$attempt"
  done
  return 1
}

ensure_agent_cli_package @openai/codex codex
ensure_agent_cli_package @agentclientprotocol/codex-acp codex-acp
ensure_agent_cli_package opencode-ai opencode

sudo -u operator env \
  HOME=/var/lib/operator \
  CODEX_HOME=/var/lib/operator/.codex \
  PATH=/var/lib/operator/npm-global/bin:/usr/local/bin:/usr/bin:/bin \
  npm_config_prefix=/var/lib/operator/npm-global \
  bash -lc 'codex --version && codex login status && opencode --version && command -v codex-acp && npm list -g --depth=0 @openai/codex @agentclientprotocol/codex-acp opencode-ai'

install -d -m 750 -o root -g operator /etc/operator
test -f /etc/operator/operator.env || cp deploy/ecs/operator.env.example /etc/operator/operator.env
chown root:operator /etc/operator/operator.env
chmod 640 /etc/operator/operator.env

set_operator_env() {
  local key="$1"
  local value="$2"
  local file=/etc/operator/operator.env
  python3 - "$file" "$key" "$value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
line = f"{key}={value}\n"
lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
replaced = False
out = []
for existing in lines:
    if existing.startswith(f"{key}="):
        out.append(line)
        replaced = True
    else:
        out.append(existing)
if not replaced:
    if out and not out[-1].endswith("\n"):
        out[-1] += "\n"
    out.append(line)
path.write_text("".join(out), encoding="utf-8")
PY
}

operator_env_value() {
  local key="$1"
  python3 - /etc/operator/operator.env "$key" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
if not path.exists():
    raise SystemExit(0)
for line in path.read_text(encoding="utf-8").splitlines():
    if line.startswith(f"{key}="):
        print(line.split("=", 1)[1])
        break
PY
}

ensure_operator_session_secret() {
  if [ -n "$(operator_env_value OPERATOR_SESSION_SECRET)" ]; then
    return 0
  fi
  set_operator_env OPERATOR_SESSION_SECRET "$(openssl rand -hex 32)"
}

ensure_local_operator_database() {
  if [ -n "$(operator_env_value DATABASE_URL)" ]; then
    return 0
  fi

  if ! command -v psql >/dev/null 2>&1; then
    apt-get update
    apt-get install -y postgresql
  fi
  systemctl enable --now postgresql

  local password_file=/etc/operator/operator-db-password
  if [ ! -s "$password_file" ]; then
    umask 077
    openssl rand -hex 32 > "$password_file"
  fi
  chown root:operator "$password_file"
  chmod 640 "$password_file"

  local db_password
  db_password="$(cat "$password_file")"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v operator_password="$db_password" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'operator') THEN
    CREATE ROLE operator LOGIN;
  END IF;
END
$$;
ALTER ROLE operator WITH LOGIN PASSWORD :'operator_password';
SELECT 'CREATE DATABASE operator OWNER operator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'operator')\gexec
ALTER DATABASE operator OWNER TO operator;
GRANT ALL PRIVILEGES ON DATABASE operator TO operator;
SQL
  sudo -u postgres psql -d operator -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON SCHEMA public TO operator;
SQL
  set_operator_env DATABASE_URL "postgres://operator:${db_password}@127.0.0.1:5432/operator"
}

is_local_redis_url() {
  case "$1" in
    redis://127.0.0.1 | redis://127.0.0.1:* | redis://localhost | redis://localhost:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_operator_redis() {
  local redis_url
  redis_url="${REDIS_URL:-$(operator_env_value REDIS_URL)}"
  redis_url="${redis_url:-redis://127.0.0.1:6379}"
  set_operator_env REDIS_URL "$redis_url"

  if ! is_local_redis_url "$redis_url"; then
    return 0
  fi

  if ! command -v redis-server >/dev/null 2>&1 || ! command -v redis-cli >/dev/null 2>&1; then
    apt-get update
    apt-get install -y --no-install-recommends redis-server
  fi
  systemctl enable --now redis-server
  redis-cli -u "$redis_url" ping | grep -q PONG
}

configure_operator_storage() {
  local desired_provider current_provider should_try_s3 storage_root
  local s3_endpoint s3_region s3_access_key s3_secret_key s3_force_path_style
  desired_provider="$(printf '%s' "${OPERATOR_STORAGE_PROVIDER:-}" | tr '[:upper:]' '[:lower:]')"
  current_provider="$(printf '%s' "$(operator_env_value OPERATOR_STORAGE_PROVIDER)" | tr '[:upper:]' '[:lower:]')"
  should_try_s3=false
  storage_root="${OPERATOR_STORAGE_ROOT:-$(operator_env_value OPERATOR_STORAGE_ROOT)}"
  s3_endpoint="${OPERATOR_S3_ENDPOINT:-$(operator_env_value OPERATOR_S3_ENDPOINT)}"
  s3_region="${OPERATOR_S3_REGION:-$(operator_env_value OPERATOR_S3_REGION)}"
  s3_access_key="${OPERATOR_S3_ACCESS_KEY_ID:-$(operator_env_value OPERATOR_S3_ACCESS_KEY_ID)}"
  s3_secret_key="${OPERATOR_S3_SECRET_ACCESS_KEY:-$(operator_env_value OPERATOR_S3_SECRET_ACCESS_KEY)}"
  s3_force_path_style="${OPERATOR_S3_FORCE_PATH_STYLE:-$(operator_env_value OPERATOR_S3_FORCE_PATH_STYLE)}"

  if [ -n "${OPERATOR_STORAGE_ARTIFACT_BUCKET:-}" ]; then
    set_operator_env OPERATOR_STORAGE_ARTIFACT_BUCKET "$OPERATOR_STORAGE_ARTIFACT_BUCKET"
  fi
  if [ -n "${OPERATOR_STORAGE_DRIVE_BUCKET:-}" ]; then
    set_operator_env OPERATOR_STORAGE_DRIVE_BUCKET "$OPERATOR_STORAGE_DRIVE_BUCKET"
  fi
  if [ -n "${OPERATOR_STORAGE_CACHE_BUCKET:-}" ]; then
    set_operator_env OPERATOR_STORAGE_CACHE_BUCKET "$OPERATOR_STORAGE_CACHE_BUCKET"
  fi

  if [ "$desired_provider" = "s3" ]; then
    should_try_s3=true
  elif [ -z "$desired_provider" ] && { [ "$current_provider" = "s3" ] || [ -n "$s3_endpoint" ] || [ -n "$s3_region" ]; }; then
    should_try_s3=true
  fi

  if [ "$should_try_s3" = "true" ]; then
    if [ -n "$s3_region" ] && { { [ -z "$s3_access_key" ] && [ -z "$s3_secret_key" ]; } || { [ -n "$s3_access_key" ] && [ -n "$s3_secret_key" ]; }; }; then
      set_operator_env OPERATOR_STORAGE_PROVIDER s3
      set_operator_env OPERATOR_S3_REGION "$s3_region"
      set_operator_env OPERATOR_S3_ENDPOINT "$s3_endpoint"
      set_operator_env OPERATOR_S3_ACCESS_KEY_ID "$s3_access_key"
      set_operator_env OPERATOR_S3_SECRET_ACCESS_KEY "$s3_secret_key"
      set_operator_env OPERATOR_S3_FORCE_PATH_STYLE "$s3_force_path_style"
      return 0
    fi
    printf '%s\n' "::warning::S3 object storage is not fully configured on ECS; using local filesystem object storage for artifacts."
  fi

  storage_root="${storage_root:-/var/lib/operator/object-storage}"
  install -d -m 750 -o operator -g operator "$storage_root"
  set_operator_env OPERATOR_STORAGE_PROVIDER local
  set_operator_env OPERATOR_STORAGE_ROOT "$storage_root"
}

configure_packycode_codex_home() {
  local api_key="$1"
  local base_url="$2"
  local model="$3"
  local codex_home=/var/lib/operator/.codex-packycode

  install -d -m 750 -o operator -g operator "$codex_home"
  PACKY_API_KEY="$api_key" PACKY_BASE_URL="$base_url" PACKY_MODEL="$model" PACKY_CODEX_HOME="$codex_home" python3 - <<'PY'
import json
import os
from pathlib import Path

codex_home = Path(os.environ["PACKY_CODEX_HOME"])
model = os.environ["PACKY_MODEL"]
base_url = os.environ["PACKY_BASE_URL"]
api_key = os.environ["PACKY_API_KEY"]

config = f"""model = {json.dumps(model)}
model_provider = "packycode"

[model_providers.packycode]
name = "PackyCode"
base_url = {json.dumps(base_url)}
wire_api = "responses"
requires_openai_auth = true
"""
codex_home.joinpath("config.toml").write_text(config, encoding="utf-8")
codex_home.joinpath("auth.json").write_text(json.dumps({"OPENAI_API_KEY": api_key}) + "\n", encoding="utf-8")
PY
  chown operator:operator "$codex_home/config.toml" "$codex_home/auth.json"
  chmod 640 "$codex_home/config.toml"
  chmod 600 "$codex_home/auth.json"
}

configure_deepseek_agent() {
  local deepseek_api_key
  deepseek_api_key="${OPERATOR_DEEPSEEK_API_KEY:-$(operator_env_value OPERATOR_DEEPSEEK_API_KEY)}"

  if [ -n "$deepseek_api_key" ]; then
    set_operator_env OPERATOR_DEEPSEEK_API_KEY "$deepseek_api_key"
    set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_COMMAND npx
    set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_ARGS "-y @agentclientprotocol/claude-agent-acp"
    set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_MODEL ""
    set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_CWD "$ECS_APP_DIR"
    set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_ENV '{"HOME":"${OPERATOR_REPO_ROOT}/.local/claude-code-acp-deepseek-home","CLAUDE_CONFIG_DIR":"${OPERATOR_REPO_ROOT}/.local/claude-code-acp-deepseek-home/.claude","CLAUDE_CODE_EXECUTABLE":"claude","ANTHROPIC_BASE_URL":"https://api.deepseek.com/anthropic","ANTHROPIC_AUTH_TOKEN":"$OPERATOR_DEEPSEEK_API_KEY","ANTHROPIC_API_KEY":"dummy","ANTHROPIC_MODEL":"deepseek-v4-flash","ANTHROPIC_DEFAULT_SONNET_MODEL":"deepseek-v4-flash","ANTHROPIC_DEFAULT_HAIKU_MODEL":"deepseek-v4-flash","ANTHROPIC_DEFAULT_OPUS_MODEL":"deepseek-v4-flash","CLAUDE_CODE_SUBAGENT_MODEL":"deepseek-v4-flash","API_TIMEOUT_MS":"1200000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","DISABLE_TELEMETRY":"1"}'
    set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_PERSIST_SESSION false
    operator_agent_fallback_order="${operator_agent_fallback_order},claude-code-acp-deepseek"
    return 0
  fi

  set_operator_env OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP_COMMAND ""
}

set_operator_env NODE_ENV production
set_operator_env OPERATOR_DEPLOYMENT_STAGE "${OPERATOR_DEPLOYMENT_STAGE:-$(operator_env_value OPERATOR_DEPLOYMENT_STAGE)}"
if [ -z "$(operator_env_value OPERATOR_DEPLOYMENT_STAGE)" ]; then
  set_operator_env OPERATOR_DEPLOYMENT_STAGE staging
fi
set_operator_env OPERATOR_REPO_ROOT "$ECS_APP_DIR"
set_operator_env OPERATOR_WEB_HOST 127.0.0.1
set_operator_env OPERATOR_WEB_PORT 3000
set_operator_env OPERATOR_DEPLOYED_GIT_COMMIT "$GITHUB_SHA"
set_operator_env OPERATOR_BACKEND_ENABLED true
set_operator_env OPERATOR_ALLOW_UNVERIFIED_EMAIL_LOGIN false
set_operator_env OPERATOR_DEFAULT_AGENT_SCOPE codex-acp
operator_agent_fallback_order=codex-acp,codex-acp-packycode,claude-code-acp-packycode,claude-code-acp,openhands-acp
set_operator_env OPERATOR_CODEX_ACP_COMMAND codex-acp
set_operator_env OPERATOR_CODEX_ACP_ARGS ""
set_operator_env OPERATOR_CODEX_ACP_CWD "$ECS_APP_DIR"
set_operator_env OPERATOR_CLAUDE_CODE_ACP_COMMAND npx
set_operator_env OPERATOR_CLAUDE_CODE_ACP_ARGS "-y @agentclientprotocol/claude-agent-acp"
set_operator_env OPERATOR_CLAUDE_CODE_ACP_NAME "Claude Code ACP (Agnes)"
set_operator_env OPERATOR_CLAUDE_CODE_ACP_MODEL agnes-2.0-flash
set_operator_env OPERATOR_CLAUDE_CODE_ACP_CWD "$ECS_APP_DIR"
set_operator_env OPERATOR_CLAUDE_CODE_ACP_ENV '{"HOME":"${OPERATOR_REPO_ROOT}/.local/claude-code-acp-agnes-home","CLAUDE_CONFIG_DIR":"${OPERATOR_REPO_ROOT}/.local/claude-code-acp-agnes-home/.claude","CLAUDE_CODE_EXECUTABLE":"claude","ANTHROPIC_BASE_URL":"http://127.0.0.1:4011","ANTHROPIC_API_KEY":"dummy","ANTHROPIC_MODEL":"agnes-2.0-flash","ANTHROPIC_DEFAULT_SONNET_MODEL":"agnes-2.0-flash","ANTHROPIC_DEFAULT_HAIKU_MODEL":"agnes-2.0-flash","ANTHROPIC_DEFAULT_OPUS_MODEL":"agnes-2.0-flash","CLAUDE_CODE_SUBAGENT_MODEL":"agnes-2.0-flash","API_TIMEOUT_MS":"1200000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","DISABLE_TELEMETRY":"1"}'
set_operator_env OPERATOR_OPENHANDS_ACP_NAME "OpenHands ACP (Agnes)"
set_operator_env OPERATOR_OPENHANDS_ACP_MODEL agnes-2.0-flash
set_operator_env OPERATOR_OPENHANDS_ACP_CWD "$ECS_APP_DIR"
set_operator_env OPERATOR_OPENHANDS_ACP_ENV '{"OPENAI_BASE_URL":"https://apihub.agnes-ai.com/v1","OPENAI_API_KEY":"$OPERATOR_AGNES_API_KEY","OPENHANDS_MODEL":"agnes-2.0-flash","LLM_MODEL":"agnes-2.0-flash"}'
set_operator_env OPERATOR_SKILL_CACHE_ROOT /var/lib/operator/skills
set_operator_env OPERATOR_RUNTIME_CACHE_ROOT /var/lib/operator/runtimes
set_operator_env OPERATOR_MASTRA_AGENT_TIMEOUT_SECONDS 900
set_operator_env OPERATOR_WEB_FETCH_TIMEOUT_SECONDS 30
set_operator_env OPERATOR_WEB_DOWNLOAD_MAX_BYTES 104857600
configure_operator_storage
if [ -n "${DATABASE_URL:-}" ]; then
  set_operator_env DATABASE_URL "$DATABASE_URL"
fi
if [ -n "${OPERATOR_SESSION_SECRET:-}" ]; then
  set_operator_env OPERATOR_SESSION_SECRET "$OPERATOR_SESSION_SECRET"
fi
if [ -n "${OPERATOR_PHONE_LOGIN_PROVIDER:-}" ]; then
  set_operator_env OPERATOR_PHONE_LOGIN_PROVIDER "$OPERATOR_PHONE_LOGIN_PROVIDER"
fi
if [ -n "${OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS:-}" ]; then
  set_operator_env OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS "$OPERATOR_PHONE_LOGIN_CODE_TTL_SECONDS"
fi
set_operator_env OPERATOR_PHONE_LOGIN_DEBUG_CODE false

aliyun_access_key_id="${ALIYUN_ACCESS_KEY_ID:-${OPERATOR_ALIYUN_ACCESS_KEY_ID:-}}"
aliyun_access_key_secret="${ALIYUN_ACCESS_KEY_SECRET:-${OPERATOR_ALIYUN_ACCESS_KEY_SECRET:-}}"
if [ -n "$aliyun_access_key_id" ]; then
  set_operator_env ALIYUN_ACCESS_KEY_ID "$aliyun_access_key_id"
fi
if [ -n "$aliyun_access_key_secret" ]; then
  set_operator_env ALIYUN_ACCESS_KEY_SECRET "$aliyun_access_key_secret"
fi
if [ -n "${OPERATOR_ALIYUN_REGION_ID:-}" ]; then
  set_operator_env OPERATOR_ALIYUN_REGION_ID "$OPERATOR_ALIYUN_REGION_ID"
fi
if [ -n "${OPERATOR_ALIYUN_DYPNS_ENDPOINT:-}" ]; then
  set_operator_env OPERATOR_ALIYUN_DYPNS_ENDPOINT "$OPERATOR_ALIYUN_DYPNS_ENDPOINT"
fi
if [ -n "${OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM:-}" ]; then
  set_operator_env OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM "$OPERATOR_ALIYUN_DYPNS_TEMPLATE_PARAM"
fi
if [ -n "${OPERATOR_ALIYUN_DYPNS_CODE_LENGTH:-}" ]; then
  set_operator_env OPERATOR_ALIYUN_DYPNS_CODE_LENGTH "$OPERATOR_ALIYUN_DYPNS_CODE_LENGTH"
fi
if [ -n "${OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS:-}" ]; then
  set_operator_env OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS "$OPERATOR_ALIYUN_DYPNS_INTERVAL_SECONDS"
fi
if [ -n "${OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE:-}" ]; then
  set_operator_env OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE "$OPERATOR_ALIYUN_DYPNS_RETURN_VERIFY_CODE"
fi
if [ -n "${OPERATOR_AGNES_API_KEY:-}" ]; then
  set_operator_env OPERATOR_AGNES_API_KEY "$OPERATOR_AGNES_API_KEY"
  set_operator_env OPENAI_API_KEY "$OPERATOR_AGNES_API_KEY"
  set_operator_env OPENAI_BASE_URL "https://apihub.agnes-ai.com/v1"
fi
packy_api_key="${OPERATOR_PACKY_API_KEY:-$(operator_env_value OPERATOR_PACKY_API_KEY)}"
packy_base_url="${OPERATOR_PACKY_BASE_URL:-$(operator_env_value OPERATOR_PACKY_BASE_URL)}"
packy_model="${OPERATOR_PACKY_MODEL:-$(operator_env_value OPERATOR_PACKY_MODEL)}"
packy_anthropic_base_url="${OPERATOR_PACKY_ANTHROPIC_BASE_URL:-$(operator_env_value OPERATOR_PACKY_ANTHROPIC_BASE_URL)}"
packy_claude_model="${OPERATOR_PACKY_CLAUDE_MODEL:-$(operator_env_value OPERATOR_PACKY_CLAUDE_MODEL)}"
packy_image_api_key="${OPERATOR_PACKY_IMAGE_API_KEY:-$(operator_env_value OPERATOR_PACKY_IMAGE_API_KEY)}"
packy_image_base_url="${OPERATOR_PACKY_IMAGE_BASE_URL:-$(operator_env_value OPERATOR_PACKY_IMAGE_BASE_URL)}"
packy_image_model="${OPERATOR_PACKY_IMAGE_MODEL:-$(operator_env_value OPERATOR_PACKY_IMAGE_MODEL)}"
packy_image_quality="${OPERATOR_PACKY_IMAGE_QUALITY:-$(operator_env_value OPERATOR_PACKY_IMAGE_QUALITY)}"
packy_base_url="${packy_base_url:-https://www.packyapi.com/v1}"
packy_model="${packy_model:-gpt-5.5}"
packy_anthropic_base_url="${packy_anthropic_base_url:-https://www.packyapi.com}"
packy_claude_model="${packy_claude_model:-claude-opus-4-8}"
packy_image_base_url="${packy_image_base_url:-$packy_base_url}"
packy_image_model="${packy_image_model:-gpt-image-2}"
packy_image_quality="${packy_image_quality:-low}"
if [ -z "${OPERATOR_PACKY_IMAGE_API_KEY:-}" ] && [ -n "$packy_api_key" ] && [ "$packy_image_api_key" = "$packy_api_key" ]; then
  packy_image_api_key=""
fi
set_operator_env OPERATOR_PACKY_BASE_URL "$packy_base_url"
set_operator_env OPERATOR_PACKY_MODEL "$packy_model"
set_operator_env OPERATOR_PACKY_ANTHROPIC_BASE_URL "$packy_anthropic_base_url"
set_operator_env OPERATOR_PACKY_CLAUDE_MODEL "$packy_claude_model"
set_operator_env OPERATOR_PACKY_IMAGE_BASE_URL "$packy_image_base_url"
set_operator_env OPERATOR_PACKY_IMAGE_MODEL "$packy_image_model"
set_operator_env OPERATOR_PACKY_IMAGE_QUALITY "$packy_image_quality"
set_operator_env OPERATOR_PACKY_IMAGE_API_KEY "$packy_image_api_key"
if [ -n "$packy_api_key" ]; then
  set_operator_env OPERATOR_PACKY_API_KEY "$packy_api_key"
  configure_packycode_codex_home "$packy_api_key" "$packy_base_url" "$packy_model"
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_COMMAND codex-acp
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_ARGS ""
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_MODEL ""
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_CWD "$ECS_APP_DIR"
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_ENV '{"CODEX_HOME":"/var/lib/operator/.codex-packycode","OPENAI_API_KEY":"$OPERATOR_PACKY_API_KEY","OPENAI_BASE_URL":"$OPERATOR_PACKY_BASE_URL"}'
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_PERSIST_SESSION false
  install -d -m 750 -o operator -g operator /var/lib/operator/.claude-code-acp-packycode-home
  install -d -m 750 -o operator -g operator /var/lib/operator/.claude-code-acp-packycode-home/.claude
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_COMMAND npx
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_ARGS "-y @agentclientprotocol/claude-agent-acp"
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_NAME "Claude Code ACP (PackyCode)"
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_MODEL ""
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_CWD "$ECS_APP_DIR"
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_ENV '{"HOME":"/var/lib/operator/.claude-code-acp-packycode-home","CLAUDE_CONFIG_DIR":"/var/lib/operator/.claude-code-acp-packycode-home/.claude","CLAUDE_CODE_EXECUTABLE":"claude","ANTHROPIC_BASE_URL":"$OPERATOR_PACKY_ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN":"$OPERATOR_PACKY_API_KEY","ANTHROPIC_API_KEY":"$OPERATOR_PACKY_API_KEY","ANTHROPIC_MODEL":"$OPERATOR_PACKY_CLAUDE_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL":"$OPERATOR_PACKY_CLAUDE_MODEL","ANTHROPIC_DEFAULT_HAIKU_MODEL":"$OPERATOR_PACKY_CLAUDE_MODEL","ANTHROPIC_DEFAULT_OPUS_MODEL":"$OPERATOR_PACKY_CLAUDE_MODEL","CLAUDE_CODE_SUBAGENT_MODEL":"$OPERATOR_PACKY_CLAUDE_MODEL","API_TIMEOUT_MS":"1200000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","DISABLE_TELEMETRY":"1"}'
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_PERSIST_SESSION false
else
  set_operator_env OPERATOR_CODEX_ACP_PACKYCODE_COMMAND ""
  set_operator_env OPERATOR_CLAUDE_CODE_ACP_PACKYCODE_COMMAND ""
fi
configure_deepseek_agent
set_operator_env OPERATOR_AGENT_FALLBACK_ORDER "$operator_agent_fallback_order"
if [ -n "${OPERATOR_BRAVE_SEARCH_API_KEY:-}" ]; then
  set_operator_env OPERATOR_BRAVE_SEARCH_API_KEY "$OPERATOR_BRAVE_SEARCH_API_KEY"
fi
if [ -n "${OPERATOR_TAVILY_API_KEY:-}" ]; then
  set_operator_env OPERATOR_TAVILY_API_KEY "$OPERATOR_TAVILY_API_KEY"
fi
if [ -n "${OPERATOR_SERPER_API_KEY:-}" ]; then
  set_operator_env OPERATOR_SERPER_API_KEY "$OPERATOR_SERPER_API_KEY"
fi
if [ -n "${OPERATOR_BING_SEARCH_API_KEY:-}" ]; then
  set_operator_env OPERATOR_BING_SEARCH_API_KEY "$OPERATOR_BING_SEARCH_API_KEY"
fi
if [ -n "${QINYAN_API_KEY:-}" ]; then
  set_operator_env QINYAN_API_KEY "$QINYAN_API_KEY"
fi
if [ -n "${CODEX_HTTPS_PROXY:-}" ]; then
  set_operator_env HTTPS_PROXY "$CODEX_HTTPS_PROXY"
  set_operator_env HTTP_PROXY "$CODEX_HTTPS_PROXY"
  set_operator_env ALL_PROXY "$CODEX_HTTPS_PROXY"
  set_operator_env NO_PROXY "127.0.0.1,localhost"
fi

ensure_local_operator_database
ensure_operator_session_secret
ensure_operator_redis

timeout --kill-after=30s 10m sudo -u operator env HOME=/var/lib/operator pnpm install --frozen-lockfile --prefer-offline

configured_database_url="$(operator_env_value DATABASE_URL)"
configured_session_secret="$(operator_env_value OPERATOR_SESSION_SECRET)"
if [ -n "$configured_database_url" ]; then
  timeout --kill-after=30s 5m sudo -u operator env \
    HOME=/var/lib/operator \
    DATABASE_URL="$configured_database_url" \
    pnpm db:migrate
fi

clean_incomplete_operator_runtime_venvs() {
  local runtime_cache_root=/var/lib/operator/runtimes
  local runtime_dir
  local venv

  [ -d "$runtime_cache_root" ] || return 0
  while IFS= read -r -d '' runtime_dir; do
    venv="$runtime_dir/.venv"
    if [ -d "$venv" ] && { [ ! -x "$venv/bin/python" ] || [ ! -x "$venv/bin/pip" ]; }; then
      printf 'Removing incomplete Operator Python runtime: %s\n' "$runtime_dir"
      rm -rf "$runtime_dir"
    fi
  done < <(find "$runtime_cache_root" -mindepth 2 -maxdepth 2 -type d -print0)
}

operator_env_file_timeout() {
  local limit="$1"
  shift

  timeout --kill-after=30s "$limit" sudo -u operator env \
    HOME=/var/lib/operator \
    PATH=/var/lib/operator/npm-global/bin:/usr/local/bin:/usr/bin:/bin \
    OPERATOR_REPO_ROOT="$ECS_APP_DIR" \
    OPERATOR_SKILL_CACHE_ROOT=/var/lib/operator/skills \
    OPERATOR_RUNTIME_CACHE_ROOT=/var/lib/operator/runtimes \
    python3 - "$@" <<'PY'
import os
import sys
from pathlib import Path

env_file = Path("/etc/operator/operator.env")
if env_file.exists():
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        if not raw_line or raw_line.lstrip().startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        key = key.strip()
        if key:
            os.environ[key] = value

os.environ["HOME"] = "/var/lib/operator"
os.environ["PATH"] = "/var/lib/operator/npm-global/bin:/usr/local/bin:/usr/bin:/bin"
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
PY
}

sync_operator_skills() {
  local skills=()
  local skills_json
  skills_json="$(operator_env_file_timeout 2m pnpm --silent capabilities:list --kind skill)"
  mapfile -t skills < <(python3 -c '
import json
import sys

payload = json.load(sys.stdin)
for capability in payload.get("capabilities", []):
    capability_id = capability.get("capability_id")
    if isinstance(capability_id, str) and capability_id:
        print(capability_id)
' <<<"$skills_json")

  clean_incomplete_operator_runtime_venvs

  local skill
  for skill in "${skills[@]}"; do
    if [ "$skill" = "qinyan-academic-skills" ] && [ -z "$(operator_env_value QINYAN_API_KEY)" ]; then
      printf '%s\n' "::warning::QINYAN_API_KEY is not set; skipping qinyan-academic-skills installation."
      continue
    fi
    operator_env_file_timeout 20m pnpm capabilities:sync "$skill" --kind skill
  done
}

sync_operator_capabilities() {
  operator_env_file_timeout 20m pnpm capabilities:sync --all --kind agent
  operator_env_file_timeout 20m pnpm capabilities:sync --all --kind workflow
}

reload_or_start_nginx() {
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl restart nginx
  fi
}

configure_operator_tls() {
  local certbot_email_args=()
  local certbot_domain_args=()
  local domain

  install -d -m 755 /var/www/certbot
  cp deploy/ecs/nginx-http-bootstrap.conf /etc/nginx/sites-available/operator
  cp deploy/ecs/nginx-gzip.conf /etc/nginx/conf.d/operator-gzip.conf
  ln -sfn /etc/nginx/sites-available/operator /etc/nginx/sites-enabled/operator
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  reload_or_start_nginx

  for domain in "${operator_tls_domains[@]}"; do
    certbot_domain_args+=("-d" "$domain")
  done
  if [ -n "${OPERATOR_TLS_EMAIL:-}" ]; then
    certbot_email_args=(--email "$OPERATOR_TLS_EMAIL")
  else
    certbot_email_args=(--register-unsafely-without-email)
    printf '%s\n' "::warning::OPERATOR_TLS_EMAIL is not set; requesting Let's Encrypt certificates without expiry email notifications."
  fi

  certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --cert-name "$operator_tls_cert_name" \
    --non-interactive \
    --agree-tos \
    --keep-until-expiring \
    --expand \
    "${certbot_email_args[@]}" \
    "${certbot_domain_args[@]}"

  if [ ! -f "$operator_tls_cert_dir/fullchain.pem" ] || [ ! -f "$operator_tls_cert_dir/privkey.pem" ]; then
    printf 'Missing TLS certificate files under %s\n' "$operator_tls_cert_dir" >&2
    exit 1
  fi

  install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-operator-nginx.sh <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
systemctl reload nginx
HOOK
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-operator-nginx.sh
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true

  cp deploy/ecs/nginx-operator.conf /etc/nginx/sites-available/operator
  nginx -t
}

sync_operator_skills
sync_operator_capabilities
test -f apps/web/.next/BUILD_ID
chown -R operator:operator apps/web/.next

cp deploy/ecs/operator.service /etc/systemd/system/operator.service
cp deploy/ecs/operator-workers.service /etc/systemd/system/operator-workers.service
configure_operator_tls

systemctl daemon-reload
systemctl disable --now operator-presentation-worker 2>/dev/null || true
systemctl enable operator operator-workers
systemctl restart operator
systemctl restart operator-workers

for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/healthz >/tmp/operator-healthz.json; then
    cat /tmp/operator-healthz.json
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    journalctl -u operator --no-pager -n 200
    exit 1
  fi
  sleep 1
done
if ! systemctl is-active --quiet operator-workers; then
  journalctl -u operator-workers --no-pager -n 200
  exit 1
fi

nginx -t
systemctl reload nginx
systemctl is-active --quiet operator
systemctl is-active --quiet operator-workers
systemctl is-active --quiet nginx
curl -fsS http://127.0.0.1:3000/api/operator/scopes >/tmp/operator-scopes.json
jq -e '.catalog.skills | length > 0' /tmp/operator-scopes.json
if ! jq -e '[.catalog.skills[] | select(.available == false and (.id | IN("qinyan-academic-skills") | not))] | length == 0' /tmp/operator-scopes.json; then
  printf '%s\n' "Unavailable Operator skills after deployment:" >&2
  jq -r '.catalog.skills[] | select(.available == false and (.id | IN("qinyan-academic-skills") | not)) | "- \(.id): \(.unavailableReason // "unavailable")"' /tmp/operator-scopes.json >&2
  exit 1
fi
curl -fsS http://127.0.0.1:3000/api/operator/backend/status >/tmp/operator-backend-status.json
jq -e '.backend.storageConfigured == true' /tmp/operator-backend-status.json >/dev/null
jq -e '.backend.queueConfigured == true' /tmp/operator-backend-status.json >/dev/null
if [ -n "$configured_database_url" ] || [ -n "$configured_session_secret" ]; then
  jq -e '.backend.enabled == true and .backend.databaseConfigured == true and .backend.identityConfigured == true' /tmp/operator-backend-status.json >/dev/null
else
  printf '%s\n' "::warning::Operator account backend is still disabled because DATABASE_URL and OPERATOR_SESSION_SECRET are not configured in deployment secrets or /etc/operator/operator.env."
fi
printf '%s\n' "$GITHUB_SHA" > "$ECS_APP_DIR/.deployed-git-commit"
chown operator:operator "$ECS_APP_DIR/.deployed-git-commit"
