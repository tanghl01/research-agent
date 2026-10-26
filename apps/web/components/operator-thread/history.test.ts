import { EventType } from "@ag-ui/core";
import { describe, expect, test } from "vitest";
import {
  historyMessagesToUiMessages,
  normalizeHistoryMessages,
  operatorThreadUiMessagesEqual,
  type HistoryMessage,
  type RestoredRunState
} from "./history";

describe("historyMessagesToUiMessages", () => {
  test("projects persisted conversation messages into AI SDK UI messages", () => {
    const messages = [
      userMessage("persisted-user", "生成单文件 HTML 横向演示稿《企业知识库智能体》"),
      assistantMessage("persisted-assistant", "已完成")
    ];

    expect(historyMessagesToUiMessages(messages)).toEqual([
      {
        id: "persisted-user",
        role: "user",
        parts: [{ type: "text", text: "生成单文件 HTML 横向演示稿《企业知识库智能体》" }]
      },
      {
        id: "persisted-assistant",
        role: "assistant",
        parts: [{ type: "text", text: "已完成" }]
      }
    ]);
  });

  test("projects restored AG-UI run state into assistant data parts", () => {
    const restoredRun: RestoredRunState = {
      phase: "running",
      events: [
        {
          type: EventType.RUN_STARTED,
          threadId: "task_restore_running",
          runId: "web_restore_running",
          timestamp: Date.parse("2026-06-15T14:30:00.000Z")
        }
      ]
    };

    const messages = historyMessagesToUiMessages([userMessage("persisted-user", "恢复运行中任务")], {
      restoredRun,
      taskId: "task_restore_running"
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.parts).toEqual([
      {
        type: "data-ag-ui-event",
        id: expect.stringMatching(/^restored_event_0_/u),
        data: restoredRun.events[0]
      }
    ]);
  });

  test("compares UI message projections by normalized protocol payload", () => {
    const left = historyMessagesToUiMessages([userMessage("same-id", "同一条消息")]);
    const right = historyMessagesToUiMessages([userMessage("same-id", "同一条消息")]);
    const changed = historyMessagesToUiMessages([userMessage("same-id", "另一条消息")]);

    expect(operatorThreadUiMessagesEqual(left, right)).toBe(true);
    expect(operatorThreadUiMessagesEqual(left, changed)).toBe(false);
  });

  test("normalizes duplicate persisted ids before handing messages to assistant-ui", () => {
    const messages = normalizeHistoryMessages(
      [
        { id: "client-reused-id", role: "user", content: "第一次提交" },
        { id: "client-reused-id", role: "user", content: "重试提交" },
        { id: "client-reused-id", role: "assistant", content: "完成" }
      ],
      "task"
    );

    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);

    const uiMessages = historyMessagesToUiMessages(messages);
    expect(new Set(uiMessages.map((message) => message.id)).size).toBe(uiMessages.length);
  });
});

function userMessage(id: string, content: string): HistoryMessage {
  return { id, role: "user", content };
}

function assistantMessage(id: string, content: string): HistoryMessage {
  return { id, role: "assistant", content };
}
