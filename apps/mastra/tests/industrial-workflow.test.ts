import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot, syncCapability } from "@operator/core";
import { describe, expect, test } from "vitest";
import { runWorkflow } from "../src/runner.js";

const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAAAyCAIAAABET8urAAAAbklEQVR4nO3PQQ2AMBQFwcqAMx5RhhJEIAADoICEhEPL+5OsgJ12nFepWvcDYGBgYGBg4DIBpwecHnB6wOkBpwf80Lzu4wcMDAxcFhzTV/C2TG/q7gQGBgYGBgYeIGBgYOBS4N8FnB5wesDplQPf4H4kvO+iQBIAAAAASUVORK5CYII=",
  "base64"
);

const requireDocumentRuntime = process.env.OPERATOR_RUN_DOCUMENT_RUNTIME_TESTS === "1";
const hasXelatex = commandExists("xelatex");

describe("industrial daily monitoring workflow", () => {
  test.skipIf(!hasXelatex && !requireDocumentRuntime)(
    "renders a LaTeX PDF report from industrial findings and meter readings",
    async () => {
      if (!hasXelatex) {
        throw new Error("OPERATOR_RUN_DOCUMENT_RUNTIME_TESTS=1 but xelatex is not available.");
      }

      const workspace = `tmp/test-runs/industrial-daily-report-${process.pid}-${Date.now()}`;
      const absoluteWorkspace = path.join(repoRoot(), workspace);
      const previousCapabilityStateRoot = process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT;
      rmSync(absoluteWorkspace, { recursive: true, force: true });
      process.env.OPERATOR_CAPABILITY_INSTALL_STATE_ROOT = path.join(absoluteWorkspace, ".capabilities");
      mkdirSync(path.join(absoluteWorkspace, "input/attachments"), { recursive: true });
      mkdirSync(path.join(absoluteWorkspace, "runs/industrial-leak-detection/output"), { recursive: true });
      mkdirSync(path.join(absoluteWorkspace, "runs/industrial-meter-reading/output"), { recursive: true });

      writeFileSync(path.join(absoluteWorkspace, "input/attachments/site.png"), pngFixture);
      writeFileSync(
        path.join(absoluteWorkspace, "runs/industrial-leak-detection/output/leak_analysis.json"),
        JSON.stringify(
          {
            schema: "operator.industrial.leak_detection.v1",
            findings: [
              {
                type: "water_leak",
                severity: "high",
                confidence: 0.86,
                evidence: "管道法兰下方可见连续水迹，地面出现反光积水。",
                recommended_action: "隔离该点位并安排紧固或更换密封件。",
                image_path: "input/attachments/site.png"
              }
            ]
          },
          null,
          2
        )
      );
      writeFileSync(
        path.join(absoluteWorkspace, "runs/industrial-meter-reading/output/meter_readings.json"),
        JSON.stringify(
          {
            schema: "operator.industrial.meter_reading.v1",
            readings: [
              {
                meter_type: "digital_led",
                value: 0.72,
                unit: "MPa",
                display_text: "0.72 MPa",
                confidence: 0.91,
                status: "normal",
                evidence: "LED 数显区域清晰，读数稳定。"
              }
            ]
          },
          null,
          2
        )
      );

      try {
        await syncCapability("industrial.daily-monitoring-report", { kind: "workflow" });

        const result = await runWorkflow({
          workspace,
          workflowId: "industrial.daily-monitoring-report",
          input: {
            topic: "站点：A区泵房 工业日常监测报告",
            workspace,
            workflow_id: "industrial.daily-monitoring-report"
          }
        });

        expect(result.status).toBe("succeeded");
        expect(result.result?.outputFormat).toBe("pdf");
        expect(result.result?.outputs.reportPdf).toBe("runs/industrial-daily-report/output/industrial_daily_report.pdf");
        const resultWorkspace = result.result?.workspace ?? absoluteWorkspace;
        expect(existsSync(path.join(resultWorkspace, result.result?.outputs.reportPdf ?? ""))).toBe(true);
        expect(statSync(path.join(resultWorkspace, result.result?.outputs.reportPdf ?? "")).size).toBeGreaterThan(2_000);
        expect(existsSync(path.join(resultWorkspace, result.result?.outputs.reportTex ?? ""))).toBe(true);
        expect(existsSync(path.join(resultWorkspace, result.result?.outputs.reportMarkdown ?? ""))).toBe(true);
        expect(existsSync(path.join(resultWorkspace, result.result?.outputs.reportJson ?? ""))).toBe(true);
        expect(result.result?.artifacts.some((artifact) => artifact.path.endsWith(".pdf"))).toBe(true);

        const markdown = readFileSync(path.join(resultWorkspace, result.result?.outputs.reportMarkdown ?? ""), "utf8");
        expect(markdown).toContain("water_leak");
        expect(markdown).toContain("0.72 MPa");
      } finally {
        restoreEnv("OPERATOR_CAPABILITY_INSTALL_STATE_ROOT", previousCapabilityStateRoot);
      }
    },
    180_000
  );
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function commandExists(command: string): boolean {
  try {
    execFileSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
