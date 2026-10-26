import { describe, expect, it } from "vitest";
import { classifyResource, chunkText, isDownloadUrl, normalizeUrl } from "../src/utils.js";

describe("@operator/knowledge-ingestion utils", () => {
  it("normalizes public URLs and filters download URLs", () => {
    expect(normalizeUrl("/2026/0701/c1/page.htm#top", "https://www.sdju.edu.cn/")).toBe("https://www.sdju.edu.cn/2026/0701/c1/page.htm");
    expect(isDownloadUrl("https://www.sdju.edu.cn/_upload/article/files/a/b/file.docx")).toBe(true);
    expect(isDownloadUrl("https://work.sdju.edu.cn/app/base/start.jsp?process=workflowFile")).toBe(true);
    expect(isDownloadUrl("https://xsc.sdju.edu.cn/_redirect?siteId=71&columnId=1128&articleId=70702")).toBe(true);
    expect(isDownloadUrl("https://www.sdju.edu.cn/_upload/tpl/style.css")).toBe(false);
  });

  it("classifies common knowledge resources", () => {
    expect(classifyResource("https://www.sdju.edu.cn/a.zip", "application/zip")).toBe("archive");
    expect(classifyResource("https://www.sdju.edu.cn/notice/page.htm", "text/html", "研究生通知")).toBe("notice");
    expect(classifyResource("https://www.sdju.edu.cn/form.docx", "application/msword", "请假申请表")).toBe("template");
  });

  it("chunks normalized text", () => {
    const chunks = chunkText("a".repeat(7000), 3000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.ordinal).toBe(0);
  });
});
