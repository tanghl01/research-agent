import fs from "node:fs";
import path from "node:path";
import pptxgen from "./node_modules/pptxgenjs/dist/pptxgen.es.js";
import QRCode from "./node_modules/qrcode/lib/index.js";

const root = path.resolve(new URL(".", import.meta.url).pathname);
const assets = path.join(root, "assets");
const outPptx = path.join(root, "operator_seed_pitch_deck.pptx");
const outlinePath = path.join(root, "operator_seed_pitch_outline.md");
const researchPath = path.join(root, "operator_pitch_research_notes.md");
const siteQrPath = path.join(assets, "baozizhineng-qr.png");
const siteQrValue = "https://baozizhineng.com/";
const wechatQrPath = path.join(assets, "wechat-qr-cropped.png");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Operator";
pptx.company = "Operator";
pptx.subject = "Seed-stage startup competition pitch deck";
pptx.title = "Operator Seed Pitch Deck";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "Microsoft YaHei",
  bodyFontFace: "Microsoft YaHei",
  lang: "zh-CN"
};
pptx.defineLayout({ name: "CUSTOM_WIDE", width: 13.333, height: 7.5 });
pptx.layout = "CUSTOM_WIDE";

const C = {
  ink: "101827",
  ink2: "1E293B",
  slate: "475569",
  muted: "64748B",
  light: "F7FAFC",
  panel: "FFFFFF",
  line: "D8E2EA",
  cyan: "17B7C8",
  mint: "1FD6A5",
  amber: "F5A524",
  greenDark: "0B6B5E",
  red: "E24A4A"
};

const W = 13.333;
const H = 7.5;
const F = "Microsoft YaHei";
const FT = "Trebuchet MS";
const BODY_SHIFT = 0.4;
let currentYShift = 0;

function yPos(y) {
  return y + currentYShift;
}

function bodySlide(color = C.light) {
  currentYShift = BODY_SHIFT;
  const slide = pptx.addSlide();
  bg(slide, color);
  return slide;
}

function addNotes(slide, notes) {
  if (typeof slide.addNotes === "function") slide.addNotes(notes);
}

function bg(slide, color = C.light) {
  slide.background = { color };
}

function rect(slide, x, y, w, h, fill, opts = {}) {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y: yPos(y),
    w,
    h,
    fill: { color: fill, transparency: opts.transparency ?? 0 },
    line: opts.line ?? { color: fill, transparency: 100 },
    radius: opts.radius
  });
}

function round(slide, x, y, w, h, fill, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y: yPos(y),
    w,
    h,
    rectRadius: opts.r ?? 0.08,
    fill: { color: fill, transparency: opts.transparency ?? 0 },
    line: opts.line ?? { color: fill, transparency: 100 },
    shadow: opts.shadow
  });
}

function line(slide, x, y, w, h, color = C.line, width = 1.2, opts = {}) {
  slide.addShape(pptx.ShapeType.line, {
    x,
    y: yPos(y),
    w,
    h,
    line: { color, width, beginArrowType: opts.beginArrowType, endArrowType: opts.endArrowType, dash: opts.dash }
  });
}

function text(slide, value, x, y, w, h, opts = {}) {
  slide.addText(value, {
    x,
    y: yPos(y),
    w,
    h,
    margin: opts.margin ?? 0,
    fontFace: opts.fontFace ?? F,
    fontSize: opts.size ?? 16,
    color: opts.color ?? C.ink,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    breakLine: opts.breakLine,
    fit: opts.fit,
    align: opts.align ?? "left",
    valign: opts.valign ?? "top",
    paraSpaceAfterPt: opts.paraSpaceAfterPt,
    bullet: opts.bullet,
    charSpacing: opts.charSpacing
  });
}

function title(slide, value, sub, n) {
  text(slide, String(n).padStart(2, "0"), 0.55, 0.35, 0.45, 0.22, {
    size: 11,
    color: C.cyan,
    bold: true,
    fontFace: FT,
    charSpacing: 1.6
  });
  text(slide, value, 1.08, 0.18, 9.4, 0.62, { size: 30, color: C.ink, bold: true, fit: "shrink" });
  if (sub) text(slide, sub, 1.1, 0.83, 8.6, 0.36, { size: 13, color: C.muted, fit: "shrink" });
}

function footer(slide, dark = false) {
  const prev = currentYShift;
  currentYShift = 0;
  try {
    text(slide, "Operator 算子 | Seed-stage startup competition deck", 0.55, 7.08, 6.7, 0.18, {
      size: 7.5,
      color: dark ? "D9E8E6" : "7A8998",
      fontFace: FT
    });
    text(slide, "internal beta", 11.8, 7.08, 0.95, 0.18, {
      size: 7.5,
      color: dark ? C.mint : C.greenDark,
      align: "right",
      fontFace: FT,
      bold: true
    });
  } finally {
    currentYShift = prev;
  }
}

function pill(slide, label, x, y, w, color = C.cyan, fill = "E9FBFC") {
  round(slide, x, y, w, 0.32, fill, { line: { color, width: 0.8 } });
  text(slide, label, x + 0.12, y + 0.065, w - 0.24, 0.16, { size: 10, color, bold: true, align: "center", fit: "shrink" });
}

function metric(slide, num, label, x, y, w, color = C.cyan) {
  text(slide, num, x, y, w, 0.52, { size: 35, color, bold: true, fontFace: FT, fit: "shrink" });
  text(slide, label, x, y + 0.58, w, 0.46, { size: 12.2, color: C.slate, fit: "shrink" });
}

function card(slide, x, y, w, h, heading, body, accent = C.cyan) {
  round(slide, x, y, w, h, C.panel, {
    line: { color: "DCE8EF", width: 0.9 },
    shadow: { type: "outer", color: "8AA2B2", blur: 0.6, offset: 1, angle: 45, opacity: 0.11 }
  });
  rect(slide, x, y, 0.08, h, accent);
  text(slide, heading, x + 0.25, y + 0.2, w - 0.45, 0.34, { size: 16.5, color: C.ink, bold: true, fit: "shrink" });
  text(slide, body, x + 0.25, y + 0.68, w - 0.45, h - 0.88, { size: 12.4, color: C.slate, fit: "shrink" });
}

function miniNode(slide, label, x, y, w = 1.15, color = C.cyan) {
  round(slide, x, y, w, 0.42, "FFFFFF", { line: { color, width: 1 } });
  text(slide, label, x + 0.06, y + 0.115, w - 0.12, 0.16, { size: 9.3, color: C.ink, align: "center", bold: true, fit: "shrink" });
}

function addContainedImage(slide, imgPath, x, y, w, h, aspectRatio, borderColor = C.line) {
  round(slide, x, y, w, h, "FFFFFF", {
    line: { color: borderColor, width: 0.9 },
    shadow: { type: "outer", color: "8AA2B2", blur: 0.6, offset: 1, angle: 45, opacity: 0.12 }
  });
  const pad = 0.11;
  const boxW = w - pad * 2;
  const boxH = h - pad * 2;
  let imgW = boxW;
  let imgH = imgW / aspectRatio;
  if (imgH > boxH) {
    imgH = boxH;
    imgW = imgH * aspectRatio;
  }
  slide.addImage({ path: imgPath, x: x + pad + (boxW - imgW) / 2, y: yPos(y + pad + (boxH - imgH) / 2), w: imgW, h: imgH });
}

function addResearchFiles() {
  const outline = `# Operator 7 分钟创业大赛路演 PPT 大纲

建议页数：12 页，其中封面 1 页、正文 11 页。7 分钟内，核心叙事页 30-40 秒，团队、案例、诉求页快速带过。

0. 封面：Operator 项目定位与种子期状态。
1. 痛点：专业工作流能力分散、不可复用、产物不可验证。
2. 方案：Operator 是云端 Linux 专业 Skill Agent 平台。
3. 产品演示：Web 工作台、执行范围标签、任务执行、PPTX 产物。
4. 技术架构：Web/API、Mastra 控制面、ACP Runtime、Workspace Skills、Artifact。
5. 差异化增长引擎：夜间 GitHub 高星 skill 扫描 + 个人/全站推荐。
6. 市场与切入：从高产物密度的专业场景切入，逐步扩展到能力市场。
7. 团队：陈智鹏、王小刚与学生工程小队。
8. 垂直案例：论文/教师智能体评估路径。
9. 垂直案例：MakerAI 硬件 3D 外壳设计界面。
10. 进展与路线图：现有原型、内测、90 天目标、商业模式。
11. 本轮诉求：内测用户、skill 合作与联系二维码。
`;
  const research = `# Operator Pitch Research Notes

## 外部路演资料

- YC Seed Deck Guide: 强调短、清晰、按投资人理解顺序展开。用于本 deck 的 Problem -> Solution -> Product -> Why now/Market -> Team/Ask 结构。
- NextView startup pitch template: 强调 7 分钟讨论型 pitch 应该用少量高信号页面，appendix 后置。因此本 deck 控制在 12 页。
- Slidebean pitch deck examples: 汇总 Airbnb、Uber、Sequoia、YC、Guy Kawasaki 等参考；用于确认 10 页左右是常见投资/比赛 deck 密度。
- Public deck downloads analyzed locally:
  - docs/ppt/research/airbnb-pitch-example.pdf
  - docs/ppt/research/uber-pitch-deck.pdf
  - docs/ppt/research/coinbase-seed-pitch-deck.pdf

## 公开 deck 观察

- Airbnb：先讲具体痛点，再给平台型解决方案；市场和商业模式都用简单数字表达。
- Uber：早期 deck 重点讲体验迁移和替代旧系统，不追求过度精致。
- Coinbase：非常短，用类比和早期增长信号建立信任。

## Operator 仓库依据

- README.md: 当前定位为 Mastra-first MVP，面向 external agent runtimes 和 reusable agent skills。
- docs/system/Operator_Mastra_ACP_Current_Architecture.md: 当前 runtime flow 为 Web/API -> Mastra -> ACP runtimes -> Workspace Skills -> artifacts。
- docs/system/Operator_Cloud_Runtime_Positioning_vs_Marvis.md: Operator 应定位为 cloud-native Linux professional agent runtime + GitHub skill marketplace + artifact verification platform。
- skills/manifests/*.skill.json: 已有 PPT、科研、CAD、法律、生物医学、工业视觉等 skill manifest。
- apps/web/components: 前端已有任务工作台、执行范围标签、Artifact preview 和 chat execution UI。

## 创始人资料来源

- https://agentslabs.org/: 陈智鹏，博士、硕士生导师；主要从事通用智能体系统、科研自动化 AI4S/AI4M、企业垂直智能体研发；主持上海市优青、横向课题 10 余项，在研课题经费上百万元。
- https://agentslabs.org/: 王小刚，博士、教授、硕士生导师；主要从事云计算和边缘智能系统研究，围绕分布式智能体资源调度、任务编排与协同执行机制支持科研与工程应用。
- https://agentslabs.org/: 学生名单采用页面前五位：唐浩伦、詹静怡、王琪盛、谭茉曦、陈天乐。
`;
  fs.writeFileSync(outlinePath, outline);
  fs.writeFileSync(researchPath, research);
}

function coverSlide() {
  currentYShift = 0;
  const slide = pptx.addSlide();
  bg(slide, C.ink);
  rect(slide, 0, 0, W, H, C.ink);
  rect(slide, 0, 0, 4.7, H, "0B1220");
  for (let i = 0; i < 34; i += 1) {
    const x = 4.3 + ((i * 1.77) % 8.4);
    const y = 0.65 + ((i * 0.91) % 5.9);
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y,
      w: 0.06 + (i % 3) * 0.015,
      h: 0.06 + (i % 3) * 0.015,
      fill: { color: i % 5 === 0 ? C.amber : i % 2 ? C.mint : C.cyan, transparency: i % 5 === 0 ? 8 : 20 },
      line: { color: C.ink, transparency: 100 }
    });
    if (i % 4 === 0) line(slide, x - 0.28, y + 0.03, 0.56, 0.22, i % 8 === 0 ? C.amber : C.cyan, 0.45);
  }
  text(slide, "Operator", 0.62, 0.86, 2.2, 0.48, { size: 36, color: "FFFFFF", bold: true, fontFace: FT });
  text(slide, "算子", 2.58, 0.99, 1.3, 0.28, { size: 20, color: C.mint, bold: true });
  text(slide, "让开源 Skill 长成可验证的专业 Agent 工作流", 0.66, 1.78, 4.05, 1.35, {
    size: 29,
    color: "FFFFFF",
    bold: true,
    fit: "shrink"
  });
  text(slide, "云端 Linux 专业执行平台 · GitHub Skill Marketplace · Artifact Verification", 0.68, 3.42, 4.0, 0.52, {
    size: 13.2,
    color: "B8D8D5",
    fit: "shrink"
  });
  pill(slide, "种子期 / 开发内测", 0.68, 4.22, 1.58, C.mint, "102B30");
  pill(slide, "创业大赛路演", 2.45, 4.22, 1.38, C.amber, "332714");
  text(slide, "专业智能体平台", 0.68, 6.5, 1.85, 0.2, { size: 10, color: "A9BEC6", fontFace: FT, charSpacing: 1.2 });
  miniNode(slide, "GitHub Skill", 6.1, 1.05, 1.35, C.cyan);
  miniNode(slide, "Manifest", 7.88, 1.65, 1.15, C.mint);
  miniNode(slide, "Runtime", 9.45, 2.38, 1.1, C.amber);
  miniNode(slide, "Artifact", 10.8, 3.15, 1.1, C.mint);
  line(slide, 7.35, 1.25, 0.7, 0.48, C.cyan, 1.4, { endArrowType: "triangle" });
  line(slide, 8.95, 1.85, 0.65, 0.55, C.mint, 1.4, { endArrowType: "triangle" });
  line(slide, 10.42, 2.58, 0.58, 0.56, C.amber, 1.4, { endArrowType: "triangle" });
  text(slide, "Control plane", 6.18, 4.62, 1.4, 0.2, { size: 9.5, color: "A9BEC6", fontFace: FT });
  text(slide, "Execution plane", 8.55, 4.95, 1.5, 0.2, { size: 9.5, color: "A9BEC6", fontFace: FT });
  text(slide, "Delivery plane", 10.6, 5.3, 1.3, 0.2, { size: 9.5, color: "A9BEC6", fontFace: FT });
  footer(slide, true);
  addNotes(slide, "封面 15 秒：只讲项目名、定位和种子期状态。");
}

function slide2() {
  const slide = bodySlide();
  title(slide, "专业 AI 工作流仍然难以复用", "今天的 agent 能聊天，但离稳定交付专业产物还有三道门槛。", 1);
  card(slide, 0.75, 1.45, 3.55, 3.15, "能力散落", "高价值 skill 藏在 GitHub 仓库、个人模板和脚本里，用户很难发现、安装、验证和持续更新。", C.cyan);
  card(slide, 4.9, 1.45, 3.55, 3.15, "执行不可控", "同一个任务常常需要浏览器、文件、Python、Office、CAD、LaTeX 等工具；本机环境和 agent 能力边界不稳定。", C.amber);
  card(slide, 9.05, 1.45, 3.55, 3.15, "交付不可审计", "只返回文本不够。专业用户需要真实 artifact、运行日志、hash、预览、可追溯来源和可复现路径。", C.mint);
  line(slide, 2.55, 5.25, 8.2, 0, C.line, 1.3);
  miniNode(slide, "Discover", 1.55, 5.6, 1.15, C.cyan);
  miniNode(slide, "Run", 4.05, 5.6, 0.9, C.amber);
  miniNode(slide, "Verify", 6.25, 5.6, 1.0, C.mint);
  miniNode(slide, "Reuse", 8.55, 5.6, 0.95, C.cyan);
  miniNode(slide, "Share", 10.75, 5.6, 0.95, C.mint);
  footer(slide);
  addNotes(slide, "45 秒：痛点不要抽象成大模型问题，而是落在专业任务的发现、执行、验证、复用四个环节。");
}

function slide3() {
  const slide = bodySlide();
  title(slide, "Operator：面向专业任务的 Skill Agent 平台", "把开源 skill、外部 agent runtime 和 artifact 交付标准化。", 2);
  rect(slide, 0.72, 1.26, 3.0, 5.25, "EAF8F8");
  text(slide, "用户入口", 1.0, 1.56, 1.25, 0.28, { size: 16, bold: true, color: C.greenDark });
  text(slide, "科研 / 教育 / 法律 / CAD / 工业巡检 / 文档生成", 1.0, 2.0, 2.25, 1.32, { size: 20, color: C.ink, bold: true, fit: "shrink" });
  text(slide, "不要求用户懂 runtime、依赖和工具链。", 1.0, 5.62, 2.15, 0.44, { size: 12.5, color: C.slate, fit: "shrink" });
  const layers = [
    ["Product Scopes", "skill manifest、source、version、license、output contract", C.cyan],
    ["Workspace SkillSource", "按任务暴露单个 skill 包，避免全目录污染", C.mint],
    ["ACP Runtime Chain", "Codex/Claude/Gemini/OpenHands/DeepSeek 通过 ACP 可回退", C.amber],
    ["Artifact Protocol", "生成物、日志、manifest、预览与下载统一登记", C.cyan]
  ];
  layers.forEach(([h, b, c], i) => {
    const y = 1.25 + i * 1.28;
    round(slide, 4.15, y, 7.9, 0.92, "FFFFFF", { line: { color: c, width: 1.1 } });
    rect(slide, 4.15, y, 0.14, 0.92, c);
    text(slide, h, 4.5, y + 0.16, 2.5, 0.26, { size: 15, bold: true, color: C.ink, fontFace: FT, fit: "shrink" });
    text(slide, b, 7.0, y + 0.17, 4.6, 0.38, { size: 12.2, color: C.slate, fit: "shrink" });
  });
  line(slide, 3.58, 3.85, 0.52, 0, C.cyan, 1.8, { endArrowType: "triangle" });
  text(slide, "价值：让 agent 能把专业任务真正做完，并留下可验证产物。", 4.2, 6.58, 6.0, 0.24, {
    size: 15.5,
    color: C.greenDark,
    bold: true
  });
  footer(slide);
  addNotes(slide, "50 秒：讲平台边界。Operator 不自研通用 agent loop，而是做能力目录、运行时接入、技能源和产物协议。");
}

function slide4() {
  const slide = bodySlide("FFFFFF");
  title(slide, "产品演示：任务工作台 + 执行范围标签 + 产物交付", "用户不再选择模型，而是选择任务执行范围。", 3);
  round(slide, 0.72, 1.22, 7.65, 4.82, "0F172A", { line: { color: "0F172A", width: 1 } });
  slide.addImage({ path: path.join(assets, "operator-web-demo.gif"), x: 0.88, y: yPos(1.38), w: 7.33, h: 4.58 });
  card(slide, 8.78, 1.28, 3.8, 1.25, "范围选择", "办公、教育、科研、设计、工业等标签对应 skill scope，不是简单 prompt。", C.cyan);
  card(slide, 8.78, 2.88, 3.8, 1.25, "执行反馈", "运行状态、已选 skill、步骤开始等事件在前端可见，降低黑箱感。", C.mint);
  card(slide, 8.78, 4.48, 3.8, 1.25, "Artifact 下载", "最终产物以 PPTX、HTML、PDF、CAD 等文件形式交付，可预览、可追溯。", C.amber);
  text(slide, "GIF 已嵌入 PPT；如果播放环境不支持动画，仍会显示首帧截图。", 0.9, 6.25, 5.4, 0.24, { size: 10.2, color: C.muted });
  footer(slide);
  addNotes(slide, "55 秒：展示工作台操作流。重点讲不是聊天框换皮，而是以任务和能力为中心的生产界面。");
}

function slide5() {
  const slide = bodySlide();
  title(slide, "当前 MVP 技术架构", "Mastra 做控制面，外部 ACP runtime 做执行，Operator 负责产品化交付。", 4);
  const nodes = [
    ["Web / API", "Next.js 任务工作台", 0.72, 1.65, C.cyan],
    ["Mastra", "scopes / tools / workflows", 3.1, 1.65, C.mint],
    ["ACP Runtime", "Codex ACP + fallbacks", 5.75, 1.65, C.amber],
    ["Workspace Skills", "SKILL.md / manifests / adapters", 8.55, 1.65, C.cyan],
    ["Artifacts", "pptx / html / pdf / cad / logs", 10.95, 1.65, C.mint]
  ];
  nodes.forEach(([h, b, x, y, c]) => {
    round(slide, x, y, 1.72, 1.18, "FFFFFF", { line: { color: c, width: 1.3 } });
    text(slide, h, x + 0.13, y + 0.2, 1.46, 0.24, { size: 12.8, bold: true, color: C.ink, align: "center", fontFace: FT, fit: "shrink" });
    text(slide, b, x + 0.13, y + 0.58, 1.46, 0.36, { size: 9.5, color: C.slate, align: "center", fit: "shrink" });
  });
  for (let i = 0; i < nodes.length - 1; i += 1) line(slide, nodes[i][2] + 1.72, 2.24, nodes[i + 1][2] - nodes[i][2] - 1.72, 0, C.slate, 1.2, { endArrowType: "triangle" });
  round(slide, 1.05, 4.02, 3.45, 1.3, "F5FBFE", { line: { color: "CBEFF4", width: 0.9 } });
  text(slide, "控制面", 1.35, 4.3, 0.9, 0.24, { size: 14.5, bold: true, color: C.cyan });
  text(slide, "能力目录、skill 解析、权限、任务历史、产物索引。", 1.35, 4.72, 2.7, 0.38, { size: 12, color: C.slate, fit: "shrink" });
  round(slide, 5.0, 4.02, 3.45, 1.3, "FFF8EA", { line: { color: "F6D391", width: 0.9 } });
  text(slide, "执行面", 5.3, 4.3, 0.9, 0.24, { size: 14.5, bold: true, color: "B16B00" });
  text(slide, "外部 agent runtime、工具调用、文件处理、浏览器与专业软件。", 5.3, 4.72, 2.75, 0.38, { size: 12, color: C.slate, fit: "shrink" });
  round(slide, 8.95, 4.02, 3.45, 1.3, "F0FDF7", { line: { color: "BDF4D9", width: 0.9 } });
  text(slide, "交付面", 9.25, 4.3, 0.9, 0.24, { size: 14.5, bold: true, color: C.greenDark });
  text(slide, "artifact manifest、预览、hash、下载、审计记录。", 9.25, 4.72, 2.75, 0.38, { size: 12, color: C.slate, fit: "shrink" });
  text(slide, "MVP 已注册：PPT、HTML slides、科研、CAD、法律、生物医学、工业视觉等 skill manifest。", 1.05, 6.18, 10.6, 0.34, { size: 14, color: C.ink2, bold: true, fit: "shrink" });
  footer(slide);
  addNotes(slide, "55 秒：讲架构可信度。强调当前代码中已有执行范围目录、skill manifest、前端范围标签、artifact 管线，不讲成已经商业化完备。");
}

function slide6() {
  const slide = bodySlide("0B1220");
  text(slide, "05", 0.55, 0.35, 0.45, 0.22, {
    size: 11,
    color: C.cyan,
    bold: true,
    fontFace: FT,
    charSpacing: 1.6
  });
  text(slide, "两台差异化引擎：发现与分发", 1.08, 0.18, 9.4, 0.62, { size: 30, color: "FFFFFF", bold: true, fit: "shrink" });
  text(slide, "内测期重点建设的增长机制，让 skill 供给和用户需求互相强化。", 1.1, 0.83, 8.6, 0.36, { size: 13, color: "B8D8D5", fit: "shrink" });
  const y = 1.55;
  round(slide, 0.82, y, 5.55, 4.65, "101B2B", { line: { color: "214255", width: 1 } });
  text(slide, "1. 夜间 GitHub Skill 扫描", 1.15, y + 0.3, 3.6, 0.32, { size: 18, bold: true, color: C.mint, fit: "shrink" });
  const scanSteps = ["高星仓库", "README/SKILL.md", "Manifest", "Smoke Test", "Scope Card"];
  scanSteps.forEach((s, i) => {
    const sx = 1.08 + (i % 2) * 2.45;
    const sy = y + 1.08 + Math.floor(i / 2) * 0.9;
    miniNode(slide, s, sx, sy, 1.72, i % 2 ? C.amber : C.cyan);
    if (i < scanSteps.length - 1) line(slide, sx + 1.72, sy + 0.19, 0.53, 0, i % 2 ? C.amber : C.cyan, 1, { endArrowType: "triangle" });
  });
  text(slide, "目标：把开源供给从“能搜到”推进到“能安装、能试跑、能交付”。", 1.12, y + 3.86, 4.45, 0.44, { size: 12.3, color: "C8D7D8", fit: "shrink" });

  round(slide, 6.95, y, 5.55, 4.65, "101B2B", { line: { color: "214255", width: 1 } });
  text(slide, "2. Skill 推荐与热搜", 7.28, y + 0.3, 3.0, 0.32, { size: 18, bold: true, color: C.amber, fit: "shrink" });
  metric(slide, "个人", "按用户使用频率推荐常用 skill", 7.3, y + 1.12, 1.45, C.mint);
  metric(slide, "全站", "按全站使用频率推送热搜 skill", 9.72, y + 1.12, 1.45, C.amber);
  line(slide, 8.68, y + 1.75, 0.82, 0, C.slate, 1.2, { endArrowType: "triangle" });
  round(slide, 7.35, y + 3.42, 4.18, 0.7, "F8FAFC", { line: { color: "BEECE7", width: 0.9 } });
  text(slide, "越多人用 -> 越好推荐 -> 越多高质量 skill 被验证", 7.62, y + 3.62, 3.65, 0.2, { size: 10.8, color: C.ink, align: "center", bold: true, fit: "shrink" });
  text(slide, "这不是简单商城排序，而是专业任务的能力分发层。", 7.25, y + 4.08, 4.4, 0.3, { size: 12, color: "C8D7D8", fit: "shrink" });
  footer(slide, true);
  addNotes(slide, "50 秒：这页讲差异化。把用户补充的两项特色说成内测期重点建设的增长和分发引擎，避免过度承诺。");
}

function slide7() {
  const slide = bodySlide();
  title(slide, "市场切入：高产物密度的专业场景", "先服务“要交付文件”的用户，再沉淀能力市场。", 6);
  const cols = [
    ["文档与演示", "PPTX / HTML deck / Word / PDF", "高频、低门槛、可快速验证交付"],
    ["科研与教育", "文献综述 / 数据分析 / 课程材料", "创始团队和实验室天然场景"],
    ["工程与行业", "CAD / 生信 / 法律 / 工业巡检", "高价值、强工具链、适合 runtime 复用"]
  ];
  cols.forEach(([h, b, d], i) => {
    const x = 0.82 + i * 4.05;
    round(slide, x, 1.45, 3.45, 3.45, "FFFFFF", { line: { color: i === 0 ? C.cyan : i === 1 ? C.mint : C.amber, width: 1.2 } });
    text(slide, `0${i + 1}`, x + 0.25, 1.76, 0.55, 0.24, { size: 14, bold: true, color: i === 2 ? C.amber : C.cyan, fontFace: FT });
    text(slide, h, x + 0.25, 2.13, 2.4, 0.4, { size: 20, bold: true, color: C.ink, fit: "shrink" });
    text(slide, b, x + 0.25, 2.76, 2.65, 0.48, { size: 12.8, color: C.greenDark, bold: true, fit: "shrink" });
    text(slide, d, x + 0.25, 3.62, 2.65, 0.72, { size: 12.4, color: C.slate, fit: "shrink" });
  });
  line(slide, 1.2, 5.62, 10.85, 0, C.line, 1.2);
  metric(slide, "Wedge", "先从 PPT / 文档 / 科研任务获得早期留存", 1.05, 5.88, 2.1, C.cyan);
  metric(slide, "Moat", "运行时、验证、推荐数据形成复利", 5.2, 5.88, 2.0, C.mint);
  metric(slide, "Scale", "能力市场扩展到更多垂直专业包", 9.22, 5.88, 2.0, C.amber);
  footer(slide);
  addNotes(slide, "45 秒：不虚构 TAM 数字。种子期比赛更重要的是切入点、早期用户和扩展路径。");
}

function slide8Team() {
  const slide = bodySlide("FFFFFF");
  title(slide, "团队：智能体系统 + 云边智能 + 学生工程小队", "团队来自智能体系统、云计算/边缘智能和真实项目工程训练场。", 7);
  const faculty = [
    {
      name: "陈智鹏",
      role: "博士 · 硕士生导师",
      img: path.join(assets, "chen-zhipeng.png"),
      aspect: 338 / 507,
      body: "通用智能体系统、科研自动化 AI4S/AI4M、企业垂直智能体研发。主持上海市优青、横向课题 10 余项。",
      tags: "AI Agent · AI4S · 垂直智能体"
    },
    {
      name: "王小刚",
      role: "博士 · 教授 · 硕士生导师",
      img: path.join(assets, "wang-xiaogang.jpg"),
      aspect: 299 / 320,
      body: "云计算和边缘智能系统；围绕分布式智能体资源调度、任务编排与协同执行机制开展研究。",
      tags: "Cloud AI · 分布式智能体 · 任务编排"
    }
  ];
  faculty.forEach((p, i) => {
    const x = 0.82 + i * 5.75;
    const frameX = x + 0.28;
    const frameY = 1.7;
    const frameW = 1.42;
    const frameH = 1.42;
    const maxPhotoW = frameW - 0.16;
    const maxPhotoH = frameH - 0.16;
    let photoW = maxPhotoW;
    let photoH = photoW / p.aspect;
    if (photoH > maxPhotoH) {
      photoH = maxPhotoH;
      photoW = photoH * p.aspect;
    }
    round(slide, x, 1.42, 5.35, 2.55, "F7FAFC", { line: { color: i ? C.amber : C.cyan, width: 1.1 } });
    round(slide, frameX, frameY, frameW, frameH, "FFFFFF", { line: { color: "D8E2EA", width: 0.7 } });
    slide.addImage({
      path: p.img,
      x: frameX + (frameW - photoW) / 2,
      y: yPos(frameY + (frameH - photoH) / 2),
      w: photoW,
      h: photoH
    });
    text(slide, p.name, x + 1.95, 1.7, 1.3, 0.28, { size: 20, bold: true, color: C.ink });
    text(slide, p.role, x + 1.95, 2.1, 2.75, 0.22, { size: 12.2, bold: true, color: i ? "B16B00" : C.greenDark, fit: "shrink" });
    text(slide, p.body, x + 1.95, 2.52, 2.82, 0.62, { size: 11.2, color: C.slate, fit: "shrink" });
    text(slide, p.tags, x + 1.95, 3.36, 2.85, 0.18, { size: 9.8, color: C.muted, fit: "shrink" });
  });
  round(slide, 0.82, 4.32, 11.1, 1.45, "0B1220", { line: { color: "214255", width: 1 } });
  text(slide, "学生工程小队", 1.16, 4.68, 1.7, 0.28, { size: 17, bold: true, color: C.mint });
  const students = ["唐浩伦", "詹静怡", "王琪盛", "谭茉曦", "陈天乐"];
  students.forEach((name, i) => {
    const x = 3.08 + i * 1.62;
    slide.addShape(pptx.ShapeType.ellipse, {
      x,
      y: yPos(4.58),
      w: 0.62,
      h: 0.62,
      fill: { color: i % 2 ? C.cyan : C.mint },
      line: { color: "FFFFFF", transparency: 100 }
    });
    text(slide, name.slice(0, 1), x + 0.19, 4.75, 0.24, 0.14, { size: 12.5, color: "FFFFFF", bold: true, align: "center" });
    text(slide, name, x - 0.12, 5.28, 0.86, 0.18, { size: 11.2, color: "FFFFFF", bold: true, align: "center", fit: "shrink" });
  });
  text(slide, "参与智能体系统原型、工具调用流程、科研/论文材料处理、安全智能体、AI coding 小应用和体验设计。", 1.18, 6.08, 9.1, 0.28, {
    size: 13.2,
    color: C.ink,
    bold: true,
    fit: "shrink"
  });
  text(slide, "团队资料来源：agentslabs.org", 9.8, 6.55, 2.15, 0.18, { size: 8.8, color: C.muted, align: "right" });
  footer(slide);
  addNotes(slide, "35 秒：团队页只讲人和能力组合。强调陈智鹏负责智能体系统和垂直落地，王小刚补充云边智能、任务编排和协同执行，学生小队负责原型与工程验证。");
}

function slide8EvaluationPath() {
  const slide = bodySlide("FFFFFF");
  title(slide, "垂直案例：论文 / 教师智能体评估路径", "从材料采集、试点审核、过程追踪到成效反馈，体现专业领域需要闭环质量数据。", 8);
  addContainedImage(
    slide,
    path.join(root, "thesis_agent_evaluation_path_labeled_v3.png"),
    0.78,
    1.34,
    11.78,
    5.25,
    1672 / 1260,
    C.cyan
  );
  footer(slide);
  addNotes(slide, "20 秒：用这张图说明教育/论文类垂直智能体不仅是生成内容，还需要审核、追踪、反馈和质量数据闭环。");
}

function slide9MakerAiShell() {
  const slide = bodySlide("FFFFFF");
  title(slide, "垂直案例：硬件设计工作流界面", "以 MakerAI 的 3D 外壳设计为例，专业智能体必须连接参数、仿真、材料、制造和确认动作。", 9);
  addContainedImage(
    slide,
    path.join(root, "06_详细设计_3D外壳.png"),
    0.72,
    1.32,
    11.9,
    5.2,
    1600 / 1000,
    C.amber
  );
  footer(slide);
  addNotes(slide, "20 秒：用硬件设计界面说明 Operator 要支持的不是泛聊天，而是专业软件、工程参数、仿真检查和可交付产物。");
}

function slide10() {
  const slide = bodySlide();
  title(slide, "进展、路线图与商业模式", "种子期目标：证明专业 skill 可以被稳定发现、执行、交付和复用。", 10);
  const phases = [
    ["已完成 / 原型", "前端任务工作台\nScope tags\nSkill manifests\nACP runtime chain\nArtifact manifest", C.cyan],
    ["内测中", "PPT / HTML slides\n科研 skill collection\nCAD skill collection\n法律与工业视觉\n本地 Codex worker", C.mint],
    ["未来 90 天", "GitHub 高星扫描\n个人/全站推荐\nPublic beta\n组织空间与权限\n付费 skill 试点", C.amber]
  ];
  phases.forEach(([h, b, c], i) => {
    const x = 0.78 + i * 4.1;
    round(slide, x, 1.32, 3.55, 3.78, "FFFFFF", { line: { color: c, width: 1.25 } });
    text(slide, h, x + 0.26, 1.62, 2.65, 0.34, { size: 17, color: C.ink, bold: true, fit: "shrink" });
    const lines = String(b).split("\n");
    text(
      slide,
      lines.map((l, idx) => ({ text: l, options: { bullet: true, breakLine: idx < lines.length - 1 } })),
      x + 0.36,
      2.2,
      2.8,
      1.9,
      { size: 12.1, color: C.slate, fit: "shrink" }
    );
  });
  rect(slide, 0.78, 5.75, 11.78, 0.92, "EDF7F6");
  text(slide, "商业模式", 1.05, 5.98, 1.2, 0.26, { size: 14.5, bold: true, color: C.greenDark });
  text(slide, "个人订阅 + 专业 skill 付费 + 企业私有 skill/runtime + Artifact 存储与审计", 2.18, 6.02, 7.9, 0.2, {
    size: 14.2,
    color: C.ink2,
    bold: true,
    fit: "shrink"
  });
  footer(slide);
  addNotes(slide, "50 秒：说明当前是什么、内测在验证什么、90 天内要形成什么。商业模式保持简单。");
}

function slide11() {
  const slide = bodySlide(C.ink);
  rect(slide, 0, 0, W, H, C.ink);
  text(slide, "11", 0.55, 0.35, 0.45, 0.22, { size: 11, color: C.cyan, bold: true, fontFace: FT, charSpacing: 1.6 });
  text(slide, "本轮诉求", 0.78, 0.55, 2.4, 0.56, { size: 33, color: "FFFFFF", bold: true, fit: "shrink" });
  text(slide, "把 Operator 从开发内测推进到可持续的专业 Skill Agent 平台。", 0.82, 1.14, 5.85, 0.38, {
    size: 14.8,
    color: "C8D7D8",
    fit: "shrink"
  });
  const asks = [
    ["专业场景内测", "寻找 PPT/科研/教育/CAD/法律等真实任务用户，验证稳定交付和留存。", C.mint],
    ["开源 Skill 合作", "接入高质量 GitHub skill，补充 adapter、runtime、smoke test 与产物契约。", C.cyan],
    ["赛事与产业资源", "需要创业大赛导师反馈、产业场景、算力/云资源与种子期合作机会。", C.amber]
  ];
  asks.forEach(([h, b, c], i) => {
    const y = 1.85 + i * 1.1;
    round(slide, 0.86, y, 5.6, 0.82, "101B2B", { line: { color: c, width: 1 } });
    text(slide, h, 1.16, y + 0.18, 1.55, 0.22, { size: 14.6, color: c, bold: true, fit: "shrink" });
    text(slide, b, 2.78, y + 0.16, 3.2, 0.28, { size: 11.3, color: "D7E4E7", fit: "shrink" });
  });
  round(slide, 7.05, 1.36, 2.35, 4.28, "FFFFFF", { line: { color: C.mint, width: 1.2 } });
  addContainedImage(slide, wechatQrPath, 7.33, 1.78, 1.78, 1.78, 1, C.mint);
  text(slide, "微信联系", 7.48, 4.42, 1.45, 0.24, { size: 15, color: C.ink, bold: true, align: "center" });
  text(slide, "扫码添加项目联系人", 7.32, 4.82, 1.78, 0.18, { size: 9.8, color: C.slate, align: "center", fit: "shrink" });

  round(slide, 9.82, 1.36, 2.35, 4.28, "FFFFFF", { line: { color: C.amber, width: 1.2 } });
  addContainedImage(slide, siteQrPath, 10.1, 1.78, 1.78, 1.78, 1, C.amber);
  text(slide, "网址二维码", 10.24, 4.42, 1.45, 0.24, { size: 15, color: C.ink, bold: true, align: "center" });
  text(slide, siteQrValue, 9.98, 4.82, 1.98, 0.18, { size: 9.6, color: C.greenDark, align: "center", bold: true, fit: "shrink" });
  text(slide, "邮箱：chenzhipeng@sdju.edu.cn", 0.88, 5.98, 3.4, 0.2, { size: 11.5, color: C.mint, bold: true });
  text(slide, "参考来源：agentslabs.org；YC / NextView / Slidebean；公开 Airbnb / Uber / Coinbase deck。", 0.88, 6.45, 7.2, 0.18, {
    size: 8.8,
    color: "9FB3BD"
  });
  footer(slide, true);
  addNotes(slide, "35 秒：最后一页只讲诉求和联系方式。网址二维码编码完整网址 https://baozizhineng.com/，扫码后可直接打开项目网站。");
}

await QRCode.toFile(siteQrPath, siteQrValue, {
  errorCorrectionLevel: "M",
  margin: 2,
  width: 720,
  color: {
    dark: "#101827",
    light: "#FFFFFF"
  }
});

addResearchFiles();
coverSlide();
slide2();
slide3();
slide4();
slide5();
slide6();
slide7();
slide8Team();
slide8EvaluationPath();
slide9MakerAiShell();
slide10();
slide11();

await pptx.writeFile({ fileName: outPptx });
console.log(outPptx);
