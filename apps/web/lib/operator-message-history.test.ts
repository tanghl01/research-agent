import { describe, expect, test } from "vitest";
import { compactOperatorMessages, mergeOperatorHistoricalMessages } from "./operator-message-history";

describe("operator message history helpers", () => {
  test("does not prepend persisted history when the current assistant-ui payload already includes it", () => {
    const merged = mergeOperatorHistoricalMessages(
      [
        { id: "poem-user", role: "user", content: "写一首模拟李白风格的诗歌" },
        { id: "poem-assistant-history", role: "assistant", content: "《月下登楼》" }
      ],
      [
        { id: "poem-user", role: "user", content: "写一首模拟李白风格的诗歌" },
        { id: "poem-assistant-live", role: "assistant", content: "《月下登楼》" },
        { id: "horror-user", role: "user", content: "写1000字的恐怖小说" }
      ]
    );

    expect(merged.map((message) => [message.id, message.role, message.content])).toEqual([
      ["poem-user", "user", "写一首模拟李白风格的诗歌"],
      ["poem-assistant-live", "assistant", "《月下登楼》"],
      ["horror-user", "user", "写1000字的恐怖小说"]
    ]);
  });

  test("prepends persisted history when the current payload only contains the new turn", () => {
    const merged = mergeOperatorHistoricalMessages(
      [
        { id: "poem-user", role: "user", content: "写一首模拟李白风格的诗歌" },
        { id: "poem-assistant-history", role: "assistant", content: "《月下登楼》" }
      ],
      [{ id: "horror-user", role: "user", content: "写1000字的恐怖小说" }]
    );

    expect(merged.map((message) => message.id)).toEqual(["poem-user", "poem-assistant-history", "horror-user"]);
  });

  test("compacts previously corrupted duplicate ids before rendering history", () => {
    const compacted = compactOperatorMessages([
      { id: "poem-user", role: "user", content: "写一首模拟李白风格的诗歌" },
      { id: "poem-assistant-history", role: "assistant", content: "《月下登楼》" },
      { id: "poem-user", role: "user", content: "写一首模拟李白风格的诗歌" },
      { id: "poem-assistant-live", role: "assistant", content: "《月下登楼》" },
      { id: "horror-user", role: "user", content: "写1000字的恐怖小说" },
      { id: "horror-assistant-history", role: "assistant", content: "《空屋来电》" },
      { id: "poem-user", role: "user", content: "写一首模拟李白风格的诗歌" },
      { id: "poem-assistant-live", role: "assistant", content: "《月下登楼》" },
      { id: "horror-user", role: "user", content: "写1000字的恐怖小说" },
      { id: "horror-assistant-live", role: "assistant", content: "《空屋来电》" },
      { id: "next-user", role: "user", content: "再写一个文言文的古代中国恐怖故事" }
    ]);

    expect(compacted.map((message) => [message.id, message.role])).toEqual([
      ["poem-user", "user"],
      ["poem-assistant-history", "assistant"],
      ["horror-user", "user"],
      ["horror-assistant-history", "assistant"],
      ["next-user", "user"]
    ]);
  });
});
