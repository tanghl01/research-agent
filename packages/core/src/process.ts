import { spawn } from "node:child_process";

export type CommandResult = {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; allowNonZero?: boolean } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out: ${[command, ...args].join(" ")}`));
    }, options.timeoutMs ?? 120_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const result = {
        command: [command, ...args],
        stdout,
        stderr,
        exitCode: exitCode ?? 1
      };
      if (result.exitCode !== 0 && !options.allowNonZero) {
        reject(new Error(`Command failed (${result.exitCode}): ${result.command.join(" ")}\n${stdout}\n${stderr}`.trim()));
        return;
      }
      resolve(result);
    });
  });
}
