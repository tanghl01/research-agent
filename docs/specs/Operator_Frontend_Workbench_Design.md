# Operator Frontend Workbench Design

## Positioning

Operator's MVP frontend is a task-first agent workbench. It follows the same interaction skeleton as Doubao's logged-in web UI:

- left task history and navigation
- central task conversation
- fixed bottom task composer
- artifact preview surface on the right
- full-screen account/settings surface

Operator changes the product semantics from conversation-first to task-first. Doubao's `新对话` becomes Operator's `新任务`.

## Core Layout

- Left sidebar: product identity, `新任务`, task workspace, files, scope marketplace, task history, account entry.
- Center workspace: current task thread, agent messages, artifact cards, bottom composer.
- Right preview: split artifact canvas for PPT, Word, CAD and future generated files.
- Settings: full-screen account/settings view, matching the density and hierarchy of the captured Doubao settings page.

## Scope Tag Model

The composer uses a two-level scope selector:

- Industry tabs: general, research, biomedicine, legal, engineering, education, business.
- Scope tags under each industry.

A scope tag is not a simple prompt shortcut. It can resolve to one of three runtime concepts:

- `skill scope`: constrain the general agent to a curated set of skills.
- `workflow`: run a deterministic or semi-deterministic Mastra workflow.
- `agent`: replace the general agent with a specialized agent, such as OpenHands or Biomni.

The UI exposes the type with compact badges: `技能域`, `工作流`, `智能体`.

## MVP Implementation

The current prototype is implemented in `apps/web`:

- Vite + React
- lucide-react icons
- CSS-only layout and stateful mock data
- no backend API dependency yet

The UI currently demonstrates:

- `新任务` task entry
- industry scope selector
- scope chips with runtime type badges
- task artifact cards
- PPT split preview
- Word document preview
- user account menu
- full-screen settings view

## Reference Captures

The source screenshots are stored outside the app code:

- `/home/biostar/work/doubao-screenshots/latest-targeted`
- `/home/biostar/work/doubao-screenshots/latest-settings-docs`
- `/home/biostar/work/doubao-screenshots/latest-doc-preview`
- `/home/biostar/work/doubao-screenshots/latest-word-preview`

These screenshots include private account/task data and should not be published without redaction.
