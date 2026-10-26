import type { CapabilityDescriptor } from "./types.js";

export const DEFAULT_ACP_AGENT_ID = "codex-acp";

export const DEFAULT_ACP_AGENT_FALLBACK_ORDER = [
  "codex-acp",
  "codex-acp-packycode",
  "claude-code-acp-packycode",
  "claude-code-acp",
  "openhands-acp",
  "claude-code-acp-deepseek"
] as const;

export type AcpAgentCapabilityConfig = {
  id: string;
  name: string;
  description: string;
  runtime: "mastra-acp-agent";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  model?: string;
  persistSession?: boolean;
  keywords?: string[];
};

const PREFIXED_ACP_AGENT_DEFAULTS: Array<{
  prefix: string;
  defaults: Pick<AcpAgentCapabilityConfig, "id" | "name" | "description">;
}> = [
  {
    prefix: "OPERATOR_CODEX_ACP",
    defaults: {
      id: "codex-acp",
      name: "Codex ACP",
      description: "Codex exposed through Agent Client Protocol."
    }
  },
  {
    prefix: "OPERATOR_CODEX_ACP_PACKYCODE",
    defaults: {
      id: "codex-acp-packycode",
      name: "Codex ACP (PackyCode)",
      description: "Codex exposed through ACP against PackyCode's OpenAI-compatible GPT 5.5 endpoint."
    }
  },
  {
    prefix: "OPERATOR_CLAUDE_CODE_ACP_PACKYCODE",
    defaults: {
      id: "claude-code-acp-packycode",
      name: "Claude Code ACP (PackyCode)",
      description: "Claude Code exposed through ACP against PackyCode's Anthropic-compatible Claude endpoint."
    }
  },
  {
    prefix: "OPERATOR_CLAUDE_CODE_ACP",
    defaults: {
      id: "claude-code-acp",
      name: "Claude Code ACP (Agnes)",
      description: "Claude Code exposed through Agent Client Protocol using Agnes."
    }
  },
  {
    prefix: "OPERATOR_CLAUDE_CODE_DEEPSEEK_ACP",
    defaults: {
      id: "claude-code-acp-deepseek",
      name: "Claude Code ACP (DeepSeek)",
      description: "Claude Code exposed through ACP against the DeepSeek Anthropic-compatible API."
    }
  },
  {
    prefix: "OPERATOR_OPENHANDS_ACP",
    defaults: {
      id: "openhands-acp",
      name: "OpenHands ACP (Agnes)",
      description: "OpenHands exposed through Agent Client Protocol using Agnes."
    }
  }
];

export function listAcpAgentCapabilityConfigs(): AcpAgentCapabilityConfig[] {
  const configs = [
    ...parseExternalAgentConfigArrayEnv("OPERATOR_MASTRA_ACP_AGENTS_JSON"),
    ...parseExternalAgentConfigArrayEnv("OPERATOR_ACP_AGENTS_JSON"),
    ...PREFIXED_ACP_AGENT_DEFAULTS.map(({ prefix, defaults }) => prefixedAcpAgentConfig(prefix, defaults)).filter(
      (config): config is AcpAgentCapabilityConfig => Boolean(config)
    )
  ];

  const byId = new Map<string, AcpAgentCapabilityConfig>();
  for (const config of configs) {
    if (isAcpAgentCapabilityConfigured(config)) byId.set(config.id, config);
  }
  return [...byId.values()];
}

export function getAcpAgentCapabilityConfig(agentId: string): AcpAgentCapabilityConfig | undefined {
  return listAcpAgentCapabilityConfigs().find((candidate) => candidate.id === agentId);
}

export function listAcpAgentCapabilityDescriptors(): CapabilityDescriptor[] {
  return listAcpAgentCapabilityConfigs().map(acpAgentCapabilityDescriptorFromConfig);
}

export function acpAgentCapabilityDescriptorFromConfig(config: AcpAgentCapabilityConfig): CapabilityDescriptor {
  const envReferences = uniqueStrings(Object.values(config.env ?? {}).flatMap(extractEnvReferences));
  return {
    kind: "agent",
    id: config.id,
    displayName: config.name,
    description: config.description,
    source: {
      type: "imported",
      provider: "env"
    },
    adapter: {
      type: "acp-agent",
      entrypoints: {
        command: config.command,
        args: JSON.stringify(config.args ?? []),
        cwd: config.cwd ?? "",
        env: JSON.stringify(config.env ?? {}),
        model: config.model ?? ""
      }
    },
    runtime: {
      type: "external",
      manager: "external",
      commands: {
        acp: [config.command, ...(config.args ?? [])].join(" ")
      }
    },
    configuration: {
      requiredEnv: envReferences,
      optionalEnv: [],
      providers: []
    },
    validation: {
      requiredPaths: [],
      capabilityTests: []
    },
    exposure: {
      scopes: [
        {
          id: config.id,
          surface: "runtime",
          enabledByDefault: true
        }
      ]
    },
    compatibilityLevel: "operator-compatible",
    sourceType: "imported"
  };
}

export function isAcpAgentCapabilityConfigured(config: { command?: string }): boolean {
  return Boolean(config.command?.trim());
}

export function extractEnvReferences(value: string): string[] {
  const refs: string[] = [];
  for (const match of value.matchAll(/\$(?:\{([A-Z0-9_]+)\}|([A-Z0-9_]+))/gu)) {
    const name = match[1] ?? match[2];
    if (name) refs.push(name);
  }
  return uniqueStrings(refs);
}

function parseExternalAgentConfigArrayEnv(name: string): AcpAgentCapabilityConfig[] {
  const value = process.env[name]?.trim();
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array of external agent configs.`);
  }
  return parsed.map((item, index) => normalizeExternalAgentConfig(item, `${name}[${index}]`));
}

function prefixedAcpAgentConfig(
  prefix: string,
  defaults: Pick<AcpAgentCapabilityConfig, "id" | "name" | "description">
): AcpAgentCapabilityConfig | undefined {
  const command = process.env[`${prefix}_COMMAND`]?.trim();
  if (!command) return undefined;
  return normalizeAcpAgentConfig(
    {
      ...defaults,
      id: optionalString(process.env[`${prefix}_ID`]) ?? defaults.id,
      name: optionalString(process.env[`${prefix}_NAME`]) ?? defaults.name,
      description: optionalString(process.env[`${prefix}_DESCRIPTION`]) ?? defaults.description,
      command,
      args: parseStringArrayEnv(process.env[`${prefix}_ARGS`]),
      cwd: process.env[`${prefix}_CWD`],
      env: parseRecordEnv(process.env[`${prefix}_ENV`]),
      model: optionalString(process.env[`${prefix}_MODEL`]) ?? legacyAcpModelEnv(prefix),
      persistSession: parseBooleanEnv(process.env[`${prefix}_PERSIST_SESSION`]),
      keywords: parseStringArrayEnv(process.env[`${prefix}_KEYWORDS`])
    },
    prefix
  );
}

function legacyAcpModelEnv(prefix: string): string | undefined {
  if (prefix === "OPERATOR_CODEX_ACP") return process.env.OPERATOR_CODEX_CLI_DEFAULT_MODEL;
  return undefined;
}

function normalizeExternalAgentConfig(value: unknown, source: string): AcpAgentCapabilityConfig {
  if (!isRecord(value)) throw new Error(`${source} must be an object.`);
  if (value.runtime === "codex-exec-proxy" || ("endpoint" in value && !("command" in value))) {
    throw new Error(`${source} uses removed runtime codex-exec-proxy. Configure an ACP agent command instead.`);
  }
  return normalizeAcpAgentConfig(value, source);
}

function normalizeAcpAgentConfig(value: unknown, source: string): AcpAgentCapabilityConfig {
  if (!isRecord(value)) throw new Error(`${source} must be an object.`);
  const id = requiredString(value.id, `${source}.id`);
  const command = requiredString(value.command, `${source}.command`);
  return {
    id,
    name: optionalString(value.name) ?? id,
    description: optionalString(value.description) ?? `External ACP agent ${id}.`,
    runtime: "mastra-acp-agent",
    command,
    args: stringArray(value.args, `${source}.args`),
    cwd: optionalString(value.cwd),
    env: stringRecord(value.env, `${source}.env`),
    model: optionalString(value.model),
    persistSession: typeof value.persistSession === "boolean" ? value.persistSession : undefined,
    keywords: stringArray(value.keywords, `${source}.keywords`)
  };
}

function parseStringArrayEnv(value: string | undefined): string[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("[")) return stringArray(JSON.parse(trimmed), "args");
  return trimmed.split(/[,\s]+/u).filter(Boolean);
}

function parseRecordEnv(value: string | undefined): Record<string, string> | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return stringRecord(JSON.parse(trimmed), "env");
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || !value.trim()) return undefined;
  return /^(1|true|yes)$/iu.test(value.trim());
}

function stringArray(value: unknown, source: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${source} must be a string array.`);
  return value.map((item, index) => requiredString(item, `${source}[${index}]`));
}

function stringRecord(value: unknown, source: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${source} must be an object.`);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, requiredString(item, `${source}.${key}`)]));
}

function requiredString(value: unknown, source: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${source} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value?.trim())))];
}
