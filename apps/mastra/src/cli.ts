#!/usr/bin/env node
import { loadDotenv } from "@operator/core";
import { runOperatorChat } from "./chat.js";
import { runWorkflow } from "./runner.js";

type CliOptions = {
  inputJson?: string;
  prompt?: string;
  workspace?: string;
  workflowId?: string;
  chat: boolean;
};

async function main(argv: string[]) {
  loadDotenv();
  const options = parseArgs(argv);
  if (options.chat) {
    const result = await runOperatorChat({
      prompt: options.prompt,
      messages: options.inputJson ? JSON.parse(options.inputJson) : undefined,
      workspace: options.workspace
    });
    console.log(JSON.stringify(result, null, 2));
    return result.status === "succeeded" ? 0 : 1;
  }
  if (!options.inputJson) {
    throw new Error("--input-json is required");
  }
  const input = JSON.parse(options.inputJson) as unknown;
  const result = await runWorkflow({
    input,
    workspace: options.workspace,
    workflowId: options.workflowId
  });
  console.log(JSON.stringify(result, null, 2));
  return result.status === "succeeded" ? 0 : 1;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { chat: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--chat") {
      options.chat = true;
    } else if (arg === "--prompt") {
      options.prompt = requiredValue(argv, ++index, arg);
    } else if (arg === "--input-json") {
      options.inputJson = requiredValue(argv, ++index, arg);
    } else if (arg === "--workspace") {
      options.workspace = requiredValue(argv, ++index, arg);
    } else if (arg === "--workflow") {
      options.workflowId = requiredValue(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  pnpm operator --chat --workspace tmp/runs/chat --prompt '请分别生成一份可编辑 PPTX 和一份 HTML 网页 PPT'
  pnpm workflow:skill2workflow --workspace tmp/runs/skill2workflow --input-json '{"topic":"转换一个 GitHub skill","output_format":"workflow_pack","skill_root":"apps/mastra/tests/fixtures/text-skill","target_workflow_id":"example.converted_skill"}'`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
