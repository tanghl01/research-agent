import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { repoRoot } from "@operator/core";
import { OPERATOR_MASTRA_SKILLS_ROOT } from "./skills/registry.js";
import { createOperatorSkillSource } from "./skills/operator-skill-source.js";

export function createOperatorWorkspace(): Workspace {
  const root = repoRoot();
  return new Workspace({
    id: "operator-mvp-workspace",
    name: "Operator MVP Workspace",
    filesystem: new LocalFilesystem({
      id: "operator-repo-fs",
      basePath: root,
      contained: true,
      allowedPaths: ["../lab"],
      instructions: ({ defaultInstructions }) =>
        [
          defaultInstructions,
          "",
          "This workspace is the Operator MVP deployment directory.",
          "Use workspace.skills for registered Mastra skills.",
          "Do not modify ignored upstream skill caches unless the active skill explicitly requires an update step."
        ].join("\n")
    }),
    sandbox: new LocalSandbox({
      id: "operator-local-sandbox",
      workingDirectory: root,
      env: process.env,
      timeout: Number(process.env.OPERATOR_MASTRA_SANDBOX_TIMEOUT_SECONDS ?? 120) * 1000
    }),
    skills: [OPERATOR_MASTRA_SKILLS_ROOT],
    skillSource: createOperatorSkillSource(),
    checkSkillFileMtime: true
  });
}

export const operatorWorkspace = createOperatorWorkspace();

export async function listMastraWorkspaceSkills() {
  if (operatorWorkspace.status === "pending") {
    await operatorWorkspace.init();
  }
  return operatorWorkspace.skills?.list() ?? [];
}
