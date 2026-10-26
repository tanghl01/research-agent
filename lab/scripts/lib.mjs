import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const labRoot = path.resolve(new URL("..", import.meta.url).pathname);
export const repoRoot = path.resolve(labRoot, "..");
export const resultsDir = path.join(labRoot, "results");
export const runsDir = path.join(labRoot, "runs");

export async function ensureDirs() {
  await mkdir(resultsDir, { recursive: true });
  await mkdir(runsDir, { recursive: true });
}

export async function writeJson(name, value) {
  await ensureDirs();
  await writeFile(path.join(resultsDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function hasEnv(name) {
  return Boolean(process.env[name] && process.env[name].trim());
}

export function redactEnvPresence(names) {
  return Object.fromEntries(names.map((name) => [name, hasEnv(name)]));
}

export function runCommand(command, args = [], options = {}) {
  const {
    cwd = labRoot,
    timeoutMs = 60_000,
    env = process.env,
    input,
    maxOutput = 80_000
  } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxOutput) stdout = stdout.slice(-maxOutput);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxOutput) stderr = stderr.slice(-maxOutput);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        ok: false,
        exitCode: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        error: error.message
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    });

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "operator-agent-runtime-lab"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function summarizeOutput(result, limit = 4_000) {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdoutTail: result.stdout?.slice(-limit) ?? "",
    stderrTail: result.stderr?.slice(-limit) ?? "",
    error: result.error
  };
}

