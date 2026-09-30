<!--
TASKS.md skeleton, Specification Stack artifact 4 of 5.
Authoring rules: Section 4 of SpecificationEngineeringPrompt-OneShot-v1.xml.
Working agreement: no task without a REQ trace; no task DONE while its
verification hook fails or is absent; one task is one reviewable changeset;
tasks are executed one at a time, test first.
-->

# TASKS

System: [system name]. Tracks SPEC.md version [1.0] and PLAN.md version [1.0].

## Task Register

| Id | Title | Implements | Depends on | Completion criteria (testable) | Verification hook (exact command) | Status | Size |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | [imperative title] | REQ-F-001 | none | [observable done condition, for example: AC-001 scenario passes; schema validation rejects the three malformed fixtures] | [for example: pytest tests/[area]/test_[name].py] | TODO | [S/M/L] |
| TASK-002 | [imperative title] | REQ-E-001 | TASK-001 | [done condition] | [command] | TODO | [S] |

Status values: TODO, IN_PROGRESS, BLOCKED([reason]), DONE([evidence ref, date]).

## Execution Discipline

1. Take exactly one task; write the failing test named by its hook first.

2. Implement to green within CONSTITUTION.md rules; never widen scope mid-task (new scope becomes a new task traced to a REQ).

3. Ship the code, the passing hook, and any specification delta in the same changeset, citing TASK and REQ ids in the changeset message.

4. On unexpected results: stop, revert, set BLOCKED(reason), record in the changelog, surface in the next state block.

## Changelog

| Date | Change | Tasks touched | Author |
| --- | --- | --- | --- |
| [YYYY-MM-DD] | Initial decomposition | all | [name] |
