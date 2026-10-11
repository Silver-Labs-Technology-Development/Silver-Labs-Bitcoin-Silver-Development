# BTCS L2 — Work Queue

Purpose: Track tasks, saved deliverables, reviews, and next steps.

## Current priorities

| Task ID | Task | Status | Deliverable | Next action |
|---|---|---|---|---|
| BTCS-L2-CLIENT-001 | Client integration, use cases, and communication | COMPLETE | docs/CLIENT-INTEGRATION-PLAN-v0.1.md | Reviewed and committed as 4d27324 |
| BTCS-L2-CLIENT-002 | Reproducible local client demonstration | READY_FOR_AGENT | execution/evm/scripts/demo-client.ts and README | Implement the demo defined in plan section 6 |

## Working rules

1. Assign one bounded task at a time.
2. Every task must have an ID and a saved deliverable.
3. Record findings in repository files, not only in agent conversations.
4. Distinguish IMPLEMENTED, PARTIAL, PLANNED, and MISSING.
5. Keep protocol and source-code changes out of documentation tasks.
6. Mark tasks READY_FOR_REVIEW when deliverables are saved.
7. Mark tasks COMPLETE only after human review.
8. Do not commit or push without explicit approval.

## Status definitions

- READY_FOR_AGENT: Defined and waiting for an agent to work on it.
- IN_PROGRESS: An agent has started the task.
- READY_FOR_REVIEW: Deliverables are saved and await review.
- BLOCKED: Work cannot continue without resolving a dependency.
- COMPLETE: Reviewed and accepted.
