import { promises as fs } from "node:fs";
import path from "node:path";
import type { SkillSource, SkillSourceEntry, SkillSourceStat } from "@mastra/core/workspace";
import {
  OPERATOR_MASTRA_SKILLS_ROOT,
  listOperatorSkillCatalog,
  resolveOperatorSkill,
  type ResolvedOperatorSkill,
  type OperatorSkillCatalogEntry
} from "./registry.js";

type ResolvedVirtualPath =
  | { kind: "root"; virtualPath: string }
  | {
      kind: "skill";
      virtualPath: string;
      skill: OperatorSkillCatalogEntry;
      resolvedSkill: ResolvedOperatorSkill;
      relativePath: string;
      actualPath: string;
    };

export class OperatorSkillSource implements SkillSource {
  readonly rootPath: string;

  constructor(rootPath = OPERATOR_MASTRA_SKILLS_ROOT) {
    this.rootPath = normalizePath(rootPath);
  }

  async exists(inputPath: string): Promise<boolean> {
    const resolved = this.resolveVirtualPath(inputPath);
    if (resolved.kind === "root") return true;
    if (await isVirtualSkillFile(resolved)) return true;
    try {
      await fs.access(resolved.actualPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(inputPath: string): Promise<SkillSourceStat> {
    const resolved = this.resolveVirtualPath(inputPath);
    if (resolved.kind === "root") {
      return {
        name: path.posix.basename(this.rootPath),
        type: "directory",
        size: 0,
        createdAt: new Date(0),
        modifiedAt: new Date()
      };
    }

    if (await isVirtualSkillFile(resolved)) {
      return {
        name: "SKILL.md",
        type: "file",
        size: Buffer.byteLength(virtualSkillFileContent(resolved.resolvedSkill), "utf8"),
        createdAt: new Date(0),
        modifiedAt: new Date(),
        mimeType: "text/markdown"
      };
    }

    const stat = await fs.stat(resolved.actualPath);
    const name = resolved.relativePath ? path.basename(resolved.actualPath) : resolved.skill.mastraName;
    return {
      name,
      type: stat.isDirectory() ? "directory" : "file",
      size: stat.isDirectory() ? 0 : stat.size,
      createdAt: stat.birthtime,
      modifiedAt: stat.mtime,
      mimeType: mimeTypeForPath(resolved.actualPath)
    };
  }

  async readFile(inputPath: string): Promise<string | Buffer> {
    const resolved = this.resolveVirtualPath(inputPath);
    if (resolved.kind === "root") {
      throw new Error(`Cannot read virtual skill root as a file: ${inputPath}`);
    }
    if (await isVirtualSkillFile(resolved)) {
      return virtualSkillFileContent(resolved.resolvedSkill);
    }
    return fs.readFile(resolved.actualPath);
  }

  async readdir(inputPath: string): Promise<SkillSourceEntry[]> {
    const resolved = this.resolveVirtualPath(inputPath);
    if (resolved.kind === "root") {
      return listOperatorSkillCatalog()
        .filter((skill) => {
          try {
            resolveOperatorSkill(skill);
            return true;
          } catch {
            return false;
          }
        })
        .map((skill) => ({
          name: skill.mastraName,
          type: "directory"
        }));
    }

    const entries = await fs.readdir(resolved.actualPath, { withFileTypes: true });
    const sourceEntries: SkillSourceEntry[] = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      isSymlink: entry.isSymbolicLink()
    }));
    if (!entries.some((entry) => entry.name === "SKILL.md") && (await shouldExposeVirtualSkillFile(resolved))) {
      return [{ name: "SKILL.md", type: "file" }, ...sourceEntries];
    }
    return sourceEntries;
  }

  async realpath(inputPath: string): Promise<string> {
    const resolved = this.resolveVirtualPath(inputPath);
    return resolved.virtualPath;
  }

  private resolveVirtualPath(inputPath: string): ResolvedVirtualPath {
    const normalized = normalizePath(inputPath);
    if (normalized === "." || normalized === this.rootPath) {
      return { kind: "root", virtualPath: this.rootPath };
    }

    const prefix = `${this.rootPath}/`;
    if (!normalized.startsWith(prefix)) {
      throw new Error(`Path is outside Operator Mastra skills root: ${inputPath}`);
    }

    const rest = normalized.slice(prefix.length);
    const [skillName, ...relativeParts] = rest.split("/").filter(Boolean);
    const skill = listOperatorSkillCatalog().find((item) => item.mastraName === skillName);
    if (!skill) {
      throw new Error(`Unknown Operator Mastra skill path: ${inputPath}`);
    }
    const relativePath = relativeParts.join("/");
    const resolved = resolveOperatorSkill(skill);
    return {
      kind: "skill",
      virtualPath: relativePath ? `${this.rootPath}/${skill.mastraName}/${relativePath}` : `${this.rootPath}/${skill.mastraName}`,
      skill,
      resolvedSkill: resolved,
      relativePath,
      actualPath: path.join(resolved.root, relativePath)
    };
  }
}

async function isVirtualSkillFile(resolved: Extract<ResolvedVirtualPath, { kind: "skill" }>): Promise<boolean> {
  return resolved.relativePath === "SKILL.md" && shouldExposeVirtualSkillFile(resolved);
}

async function shouldExposeVirtualSkillFile(resolved: Extract<ResolvedVirtualPath, { kind: "skill" }>): Promise<boolean> {
  if (resolved.resolvedSkill.subskillId) return true;
  const actualSkillPath = path.join(resolved.resolvedSkill.root, resolved.resolvedSkill.entrypoints.skill ?? "SKILL.md");
  try {
    await fs.access(actualSkillPath);
    return false;
  } catch {
    return Boolean(resolved.resolvedSkill.manifest.entrypoints?.readme);
  }
}

function virtualSkillFileContent(skill: ResolvedOperatorSkill): string {
  const entrypoints = Object.entries(skill.entrypoints)
    .map(([name, entrypoint]) => `- ${name}: ${entrypoint}`)
    .join("\n");
  const requiredPaths = skill.requiredPaths.map((entrypoint) => `- ${entrypoint}`).join("\n");
  const adapters = skill.adapters.map((adapter) => `- ${adapter.path}`).join("\n");
  const runtimeNotes = skill.runtime?.notes.map((note) => `- ${note}`).join("\n");
  const subskills = skill.subskills.map((subskill) => renderSubskillSection(skill, subskill)).join("\n\n");
  return [
    "---",
    `name: ${skill.mastraName}`,
    `description: ${JSON.stringify(skill.description)}`,
    "---",
    "",
    `# ${skill.displayName}`,
    "",
    "This is a Operator wrapper for an upstream skill source. The original repository is not modified.",
    "",
    skill.subskillId
      ? "Operator exposes this upstream subskill under a stable Mastra skill name. During execution, read the real upstream SKILL.md from the resolved skill root before acting."
      : skill.subskills.length
        ? "Operator exposes this upstream GitHub skill project as one Mastra skill. During execution, read the collection README first, then choose the relevant nested SKILL.md listed below and follow any Operator adapters/runtime commands for that nested skill."
        : "Read the collection README first, then inspect the relevant nested SKILL.md files before execution.",
    "",
    "## Source",
    "",
    `- skill id: ${skill.skillId}`,
    skill.subskillId ? `- subskill id: ${skill.subskillId}` : undefined,
    `- resolved root: ${skill.root}`,
    `- source root: ${skill.sourceRoot}`,
    "",
    "## Entrypoints",
    "",
    entrypoints || "- README.md",
    "",
    "## Required Paths",
    "",
    requiredPaths || "- README.md",
    "",
    "## Operator Adapters",
    "",
    adapters || "- No Operator adapter declared.",
    "",
    "## Runtime Notes",
    "",
    runtimeNotes || "- No dedicated runtime declared.",
    "",
    "## Nested Skills",
    "",
    subskills || "- No nested skill metadata declared."
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function renderSubskillSection(skill: ResolvedOperatorSkill, subskill: ResolvedOperatorSkill["subskills"][number]): string {
  const relativeRoot = normalizePath(path.relative(skill.sourceRoot, subskill.root)) || ".";
  const entrypoints = Object.entries(subskill.entrypoints)
    .map(([name, entrypoint]) => `  - ${name}: ${entrypoint}`)
    .join("\n");
  const adapters = subskill.adapters.map((adapter) => `  - ${adapter.path}`).join("\n");
  const commands = Object.entries(subskill.runtime?.commands ?? {})
    .map(([name, command]) => `  - ${name}: ${command}`)
    .join("\n");
  const notes = subskill.executionTarget.execution.notes?.map((note) => `  - ${note}`).join("\n");
  return [
    `### ${subskill.id}: ${subskill.displayName}`,
    "",
    subskill.description,
    "",
    `- root: ${relativeRoot}`,
    "- entrypoints:",
    entrypoints || "  - SKILL.md",
    "- Operator adapters:",
    adapters || "  - No Operator adapter declared.",
    "- Runtime commands:",
    commands || "  - No dedicated runtime commands declared.",
    "- Execution notes:",
    notes || "  - No additional execution notes declared."
  ].join("\n");
}

export function createOperatorSkillSource(): OperatorSkillSource {
  return new OperatorSkillSource();
}

function normalizePath(inputPath: string): string {
  return inputPath.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "") || ".";
}

function mimeTypeForPath(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".js":
    case ".mjs":
    case ".ts":
      return "text/javascript";
    case ".py":
      return "text/x-python";
    case ".html":
      return "text/html";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return undefined;
  }
}
