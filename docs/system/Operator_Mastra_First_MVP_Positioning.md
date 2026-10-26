# Operator Mastra-First MVP Positioning

Status: historical MVP architecture decision, superseded for current code
Date: 2026-06-10

> Current code no longer uses OpenHands as a built-in default runtime adapter
> and no longer contains `operator-main-agent`. The current architecture is
> direct ACP main execution agent + ordered ACP fallback runtimes + Mastra
> tools, workflows, and Workspace Skills. See
> `docs/system/Operator_Mastra_ACP_Current_Architecture.md` and `README.md`.

## 1. Decision

Operator MVP is a Mastra-based deployment implementation, not a parallel agent framework.

In the MVP stage, Operator should reuse Mastra for every primitive Mastra already provides: agents, workflows, tools, workspace, skills, memory, storage, events, runtime registration, and observability hooks. Operator only owns the product and business surface that Mastra does not define for this deployment.

The most valuable Operator assets are the curated open-source, internal, and industry-specific agents, skills, workflows, tools, prompts, validation policies, and artifact contracts mounted into the Mastra runtime.

## 2. Component Roles

| Component | MVP Role | Operator Should Build? |
|---|---|---|
| Mastra | Primary application framework and runtime registry | No, depend on it |
| Mastra Agent | General agent abstraction, tool loop, and agent network support | Configure and compose |
| Mastra Workspace | Filesystem, sandbox, search, skills, workspace tools | Configure and provide policies |
| Mastra Skills | Standard SKILL.md discovery, search, read, and activation | Use as the skill layer |
| Mastra Workflows | Deterministic orchestration for stable processes | Use only for stable flows |
| Mastra Tools | Typed executable actions for agents and workflows | Add only when needed |
| OpenHands | Default main coding/general execution agent runtime for open-ended work | Integrate as runtime adapter |
| Operator | Product deployment: accounts, billing, tenancy, permissions, artifact contracts, curated scope catalog | Yes |

## 3. OpenHands Positioning

Mastra provides the framework for constructing and registering agents. It does not ship an OpenHands/Codex-class full coding agent as a ready-made product primitive.

OpenHands should therefore be treated as the default main execution agent/runtime in the Operator MVP:

```text
User chat
  -> Operator chat API
  -> OpenHands main agent runtime adapter
  -> Mastra Workspace Skills / Workflows / Tools
  -> generated artifacts
  -> Operator artifact, billing, permission, and delivery layer
```

OpenHands should not be modeled as an ordinary deterministic tool when it is the primary user-facing executor. It only appears as a tool-like callable when another Mastra agent delegates to it, because LLM tool-calling protocols need a callable boundary.

Two valid modes exist in this document's historical framing:

| Mode | Recommended Use |
|---|---|
| OpenHands as main agent runtime | Default Operator chat experience |
| OpenHands as workflow step/tool | A deterministic workflow needs a bounded agentic step |

## 4. Skill Strategy

Operator skills should be Mastra Workspace Skills first.

Each production skill should be visible through a standard Mastra-compatible skill name and SKILL.md metadata. The source repository may live in one of several places:

- an ignored vendored cache under the Operator deployment directory;
- an external local development directory;
- a production cache directory;
- a content-addressable, versioned skill store.

Operator may keep a small manifest layer, but its purpose is source/version/runtime policy, not replacing Mastra skill discovery.

```text
Operator skill manifest
  -> where the source lives, version pin, license, runtime policy

Mastra Workspace Skill
  -> what the agent sees and activates: SKILL.md, references, scripts, assets
```

For MVP, Agent Skill style repositories are exposed as Mastra Workspace Skills:

| Mastra Skill Name | Source | Current Executor |
|---|---|---|
| gorden-ppt-skill | GordenPPTSkill repository | OpenHands main agent reads and executes the skill |
| guizang-ppt-skill | guizang-ppt-skill repository | OpenHands main agent reads and executes the skill |
| ppt-master | hugohe3/ppt-master repository, skill root `skills/ppt-master` | OpenHands main agent reads and executes the skill |
| scientific-agent-skills | K-Dense-AI/scientific-agent-skills collection | OpenHands inspects README and relevant nested skills |
| text-to-cad | earthtojake/text-to-cad collection | OpenHands inspects README and relevant nested skills |
| claude-for-legal | anthropics/claude-for-legal collection | OpenHands inspects README and relevant nested skills |

Not every valuable upstream project is a Workspace Skill. Biomni is registered
as `biomni-biomedical-agent`, an external biomedical domain-agent package. It
should be launched through a dedicated runtime adapter after routing, with
OpenHands or another main agent supervising the request, while Operator owns
artifact capture, audit logs, safety gates, and human review requirements.

The previous PPT workflow adapters have been removed from the current MVP code path. PPT generation now tests the intended model directly: Mastra exposes skills, OpenHands chooses and executes them, and Operator records artifacts.

## 4.1 Skill Runtime Encapsulation

Mastra should remain the skill/workspace framework. Operator's manifest layer adds only the deployment metadata Mastra does not define for this product:

- source provenance: repository, ref, pinned commit, license notice;
- root resolution: development checkout, production cache, or explicit environment override;
- subskill mapping for collection repositories;
- runtime policy: reusable dependency cache root, setup commands, evidence entrypoint, durable command names;
- artifact contract and validation expectations used by Operator delivery.

This is a control-plane layer, not a replacement for Mastra skills. The OpenHands bridge receives the resolved Mastra skill name, source root, evidence path, runtime context, output contract, and verification rules. It should reuse declared runtime caches instead of creating per-task dependency environments inside the task workspace.

Example:

```text
text-to-cad manifest
  -> source repo and commit
  -> subskills.cad root: skills/cad
  -> runtime: python_venv under OPERATOR_RUNTIME_CACHE_ROOT
  -> commands: step, inspect, snapshot

Mastra Workspace Skill
  -> text-to-cad

OpenHands execution
  -> reads README.md, then subskills.cad entrypoint skills/cad/SKILL.md
  -> uses the subskill runtime_context commands
  -> writes task artifacts and reports to the workspace
```

## 5. Workflow Strategy

Use Mastra workflows for deterministic processes:

- fixed validation pipelines;
- artifact packaging;
- known render commands;
- stable business workflows;
- repeatable regression tests;
- conversion jobs like skill2workflow.

Do not force open-ended creative or coding skills into deterministic workflows when the original skill depends on agent reading, planning, iteration, and tool use.

GordenPPTSkill is an example where the preferred execution path is agent + skill. It should not be converted into a rigid Operator-authored workflow unless a specific deterministic sub-process needs auditability or reuse.

## 6. Product Responsibilities Left To Operator

Operator should own only the deployment-specific layer:

- user accounts, tenants, billing, and quotas;
- skill availability, licensing, and user/tenant permissions;
- curated skill/workflow/agent catalog;
- artifact contracts, manifests, validation, and retention;
- runtime policy for OpenHands, local sandbox, hosted sandbox, and production isolation;
- audit logs and task history;
- frontend/API product experience.

Everything else should use Mastra primitives whenever possible.

## 7. Product Scopes

Operator keeps a small product-facing scope catalog in `apps/mastra/src/product-scopes/`.

The scope catalog is not a replacement for Mastra registration. It describes what can be exposed to users and how selected scopes route execution:

- agent scopes, such as configured main execution agents when exposed internally;
- skill scopes, such as `gorden-ppt-skill`, `guizang-ppt-skill`, `ppt-master`, `scientific-agent-skills`, `text-to-cad`, and `claude-for-legal`;
- nested subskill metadata, such as `text-to-cad` manifest `subskills.cad`, which carries tighter runtime and evidence contracts without becoming a separate user-facing scope;
- domain-agent package scopes, such as `biomni-biomedical-agent`;
- workflow scopes, such as `system.skill2workflow`;
- tool scopes, currently hidden from the top-level user picker until a tool becomes a product surface.

Mastra remains the execution framework:

```text
Operator product scope catalog
  -> product/routing metadata, selection guidance, artifact contracts

Mastra registration
  -> actual agents, workflows, tools, workspace, skill sources
```

For example, `system.skill2workflow` is registered as a workflow scope and also registered into Mastra as `skill2WorkflowWorkflow`. PPT skills are registered as skill scopes and exposed to Mastra through the Workspace SkillSource.

The chat entry should consume the scope catalog instead of hard-coding every skill or workflow locally. As the MVP grows, adding a user-facing scope should primarily mean adding catalog metadata, a manifest/source when needed, and an executor policy.

## 8. MVP Test Contract

The MVP regression scenario is:

```text
User asks in chat:
  Generate two Journey to the West literature appreciation decks for a university class:
  one editable PowerPoint deck and one web/HTML deck.

Expected:
  OpenHands main agent adapter selects:
    - gorden-ppt-skill for editable PPTX
    - guizang-ppt-skill for HTML/web deck

  OpenHands reads the selected skill sources, executes the skill instructions, and stores:
    - a PPTX artifact
    - an HTML deck artifact
    - chat plan
    - chat result metadata
    - artifact manifests
```

This test is intentionally phrased as a chat-to-agent flow. It validates the new Operator position: Mastra is the framework, OpenHands is the default main execution runtime, and skills are Mastra Workspace Skills.

The test must not use a deterministic Operator fallback to fake OpenHands output. If OpenHands is not configured, cannot reach Agnes, cannot execute the selected skills, or does not return a valid artifact list, the chat run must fail and no fake PPT artifacts should be generated by Operator application code. Operator may record `chat_request.json`, `chat_plan.json`, and `chat_result.json` explaining the failure, but it must not synthesize subject matter, audience, purpose, slide content, or skill choices in application code.
