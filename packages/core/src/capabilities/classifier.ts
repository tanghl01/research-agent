import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { CapabilityDetectResult } from "./types.js";

export function classifyCapabilityRepository(root: string): CapabilityDetectResult {
  const features = detectRepositoryFeatures(root);
  if (features.includes("operator.capability.json")) {
    return {
      compatibilityLevel: "operator-native",
      adapterType: adapterTypeFromNativeFeatures(features),
      kind: kindFromNativeFeatures(features),
      features,
      reason: "Repository declares operator.capability.json."
    };
  }
  if (features.includes("langgraph.json")) {
    return {
      compatibilityLevel: "operator-compatible",
      adapterType: "langgraph",
      kind: "workflow",
      features,
      reason: "Repository declares langgraph.json."
    };
  }
  if (features.includes("mcp.json")) {
    return {
      compatibilityLevel: "operator-compatible",
      adapterType: "mcp-tool",
      kind: "tool",
      features,
      reason: "Repository declares MCP server configuration."
    };
  }
  if (features.includes("mastra-config")) {
    return {
      compatibilityLevel: "operator-compatible",
      adapterType: "mastra-workflow",
      kind: "workflow",
      features,
      reason: "Repository contains Mastra configuration."
    };
  }
  if (features.includes("acp-config")) {
    return {
      compatibilityLevel: "operator-compatible",
      adapterType: "acp-agent",
      kind: "agent",
      features,
      reason: "Repository contains ACP runtime configuration."
    };
  }
  if (features.includes("SKILL.md")) {
    return {
      compatibilityLevel: "operator-compatible",
      adapterType: "agent-skill",
      kind: "skill",
      features,
      reason: "Repository contains Agent Skill entrypoint."
    };
  }
  return {
    compatibilityLevel: "generic-open-source",
    adapterType: "generic-github",
    kind: "package",
    features,
    reason: "Repository has no recognized Operator, Mastra, LangGraph, ACP, MCP, or Agent Skill boundary."
  };
}

export function detectRepositoryFeatures(root: string): string[] {
  const features: string[] = [];
  if (existsSync(path.join(root, "operator.capability.json"))) features.push("operator.capability.json");
  if (existsSync(path.join(root, "langgraph.json"))) features.push("langgraph.json");
  if (existsSync(path.join(root, "mcp.json")) || existsSync(path.join(root, ".mcp.json"))) features.push("mcp.json");
  if (existsSync(path.join(root, "SKILL.md"))) features.push("SKILL.md");
  if (existsSync(path.join(root, "package.json"))) features.push("package.json");
  if (existsSync(path.join(root, "pyproject.toml"))) features.push("pyproject.toml");
  if (existsSync(path.join(root, "requirements.txt"))) features.push("requirements.txt");
  if (existsSync(path.join(root, ".devcontainer", "devcontainer.json"))) features.push("devcontainer.json");
  if (hasAny(root, ["mastra.config.ts", "mastra.config.js", "mastra.config.mjs", "mastra.config.cjs"])) features.push("mastra-config");
  if (hasAny(root, ["acp.json", "agent-client-protocol.json"]) || directoryContains(root, "acp")) features.push("acp-config");
  return features;
}

function hasAny(root: string, filenames: string[]): boolean {
  return filenames.some((filename) => existsSync(path.join(root, filename)));
}

function directoryContains(root: string, pattern: string): boolean {
  if (!existsSync(root)) return false;
  return readdirSync(root).some((entry) => entry.toLowerCase().includes(pattern));
}

function adapterTypeFromNativeFeatures(features: string[]): CapabilityDetectResult["adapterType"] {
  if (features.includes("langgraph.json")) return "langgraph";
  if (features.includes("mcp.json")) return "mcp-tool";
  if (features.includes("mastra-config")) return "mastra-workflow";
  if (features.includes("acp-config")) return "acp-agent";
  if (features.includes("SKILL.md")) return "agent-skill";
  return "generic-github";
}

function kindFromNativeFeatures(features: string[]): CapabilityDetectResult["kind"] {
  const adapter = adapterTypeFromNativeFeatures(features);
  if (adapter === "agent-skill") return "skill";
  if (adapter === "acp-agent") return "agent";
  if (adapter === "mcp-tool") return "tool";
  if (adapter === "langgraph" || adapter === "mastra-workflow") return "workflow";
  return "package";
}
