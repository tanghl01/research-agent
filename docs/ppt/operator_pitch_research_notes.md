# Operator Pitch Research Notes

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
