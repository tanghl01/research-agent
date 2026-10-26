import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";

class FakeAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.cancelHandlers = new Map();
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: []
    };
  }

  async newSession() {
    return {
      sessionId: `fake-acp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      models: {
        availableModels: [
          {
            modelId: "fake-acp-model",
            name: "Fake ACP Model"
          }
        ]
      }
    };
  }

  async loadSession() {
    return {};
  }

  async authenticate() {
    return {};
  }

  async unstable_setSessionModel() {
    return {};
  }

  async prompt(params) {
    if (process.env.OPERATOR_TEST_FAKE_ACP_HANG === "1") {
      await new Promise((resolve) => this.cancelHandlers.set(params.sessionId, resolve));
      return { stopReason: "cancelled" };
    }

    const promptText = params.prompt?.map((part) => (part.type === "text" ? part.text : "")).join("\n") ?? "";
    const runtimeContext = runtimeContextFromPrompt(promptText);
    writePromptCapture(runtimeContext, promptText);
    writeConfiguredWorkspaceFiles(runtimeContext);

    const templateValues = {
      run_id: String(runtimeContext?.run_id ?? ""),
      workspace: String(runtimeContext?.workspace ?? ""),
      workspace_absolute: String(runtimeContext?.workspace_absolute ?? "")
    };
    const messages = parseJsonEnv("OPERATOR_TEST_FAKE_ACP_MESSAGES_JSON", undefined);
    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (!message || typeof message.text !== "string") continue;
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: typeof message.messageId === "string" ? message.messageId : undefined,
            content: {
              type: "text",
              text: renderTemplate(message.text, templateValues)
            }
          }
        });
      }
      return { stopReason: "end_turn" };
    }

    const response = renderTemplate(process.env.OPERATOR_TEST_FAKE_ACP_RESPONSE ?? "Fake ACP response.", templateValues);

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: response
        }
      }
    });

    return { stopReason: "end_turn" };
  }

  async cancel(params) {
    const resolve = this.cancelHandlers.get(params.sessionId);
    if (resolve) {
      this.cancelHandlers.delete(params.sessionId);
      resolve();
    }
  }
}

function runtimeContextFromPrompt(promptText) {
  const match = /Runtime context:\n([\s\S]*?)\nExecution constraints:/u.exec(promptText);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function writeConfiguredWorkspaceFiles(runtimeContext) {
  const workspace = runtimeContext?.workspace_absolute ?? runtimeContext?.workspace;
  if (typeof workspace !== "string" || !workspace) return;
  const files = parseJsonEnv("OPERATOR_TEST_FAKE_ACP_WORKSPACE_FILES", []);
  for (const file of files) {
    if (!file || typeof file.path !== "string") continue;
    const target = path.resolve(workspace, file.path);
    if (!target.startsWith(path.resolve(workspace) + path.sep) && target !== path.resolve(workspace)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    const content =
      typeof file.contentBase64 === "string" ? Buffer.from(file.contentBase64, "base64") : Buffer.from(String(file.content ?? ""));
    writeFileSync(target, content);
  }
}

function writePromptCapture(runtimeContext, promptText) {
  const capturePath = process.env.OPERATOR_TEST_FAKE_ACP_CAPTURE_PROMPT_PATH;
  const workspace = runtimeContext?.workspace_absolute ?? runtimeContext?.workspace;
  if (!capturePath || typeof workspace !== "string" || !workspace) return;
  const target = path.resolve(workspace, capturePath);
  if (!target.startsWith(path.resolve(workspace) + path.sep) && target !== path.resolve(workspace)) return;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, promptText);
}

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function renderTemplate(template, values) {
  return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/gu, (_match, key) => values[key] ?? "");
}

new AgentSideConnection(
  (connection) => new FakeAcpAgent(connection),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
);
