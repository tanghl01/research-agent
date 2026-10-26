# Text Skill Fixture

This fixture models an open-source Codex skill whose workflow is mostly prose.

## Workflow

1. Inspect the user request and source files.
2. Select the best execution mode from deterministic code, direct LLM, or a registered ACP agent.
3. Build the requested artifact with explicit intermediate files.
4. Validate that the generated artifact matches the source skill contract.

## Consistency

- The converted workflow must keep the four-step order above.
- The converted workflow must record an observable trace for every step.
- The converted workflow must include a Operator registration manifest.
