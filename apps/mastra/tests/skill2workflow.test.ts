import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot, syncCapability } from "@operator/core";
import { describe, expect, test } from "vitest";
import { runWorkflow } from "../src/runner.js";

describe("Mastra system workflows", () => {
  test("converts a text-heavy skill into a workflow pack", async () => {
    const workspace = "tmp/test-runs/skill2workflow-fixture";
    const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
    process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = path.join(repoRoot(), workspace, ".capabilities");
    try {
      await syncCapability("system.skill2workflow", { kind: "workflow" });
      const result = await runWorkflow({
        workspace,
        workflowId: "system.skill2workflow",
        input: {
          topic: "skill2workflow fixture conversion",
          output_format: "workflow_pack",
          skill_root: "apps/mastra/tests/fixtures/text-skill",
          target_workflow_id: "test.text_skill.workflow",
          target_package: "@operator/workflow-text-skill-fixture",
          codex_mode: "disabled",
          constraints: ["固化文字描述工作流", "生成 Mastra workflow pack"]
        }
      });

      expect(result.status).toBe("succeeded");
      expect(result.workflow_id).toBe("system.skill2workflow");
      expect(result.result?.outputFormat).toBe("workflow_pack");
      expect(result.result?.validation?.validated).toBe(true);
      const registrationPath = path.join(result.workspace, "output/generated/test-text-skill-workflow/operator.workflow.json");
      const workflowPath = path.join(result.workspace, "output/generated/test-text-skill-workflow/workflow.ts");
      const analysisPath = path.join(result.workspace, "output/skill2workflow_analysis.json");
      expect(existsSync(registrationPath)).toBe(true);
      expect(existsSync(workflowPath)).toBe(true);
      expect(existsSync(analysisPath)).toBe(true);
      const registration = JSON.parse(readFileSync(registrationPath, "utf8")) as {
        workflow_id: string;
        status: string;
      };
      const workflowSource = readFileSync(workflowPath, "utf8");
      expect(registration.workflow_id).toBe("test.text_skill.workflow");
      expect(registration.status).toBe("generated");
      expect(workflowSource).toContain("convertedSkillWorkflow");
      expect(workflowSource).toContain("test.text_skill.workflow");
    } finally {
      restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
