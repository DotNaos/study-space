# Study Space documentation

Documentation belongs to this repository. Distinguish accepted target behavior from the implemented runtime contracts below.

## Accepted design

- [Reviewed course-content pipeline](content-pipeline.md): source inventory versus learning structure, deterministic evidence, human/agent review, MDX script, separate tasks, precise mapping, drill-down, and update safety. Includes the implementation boundary and sequence.
- [Cross-course acceptance cases](content-pipeline-cases.md): eight observed course patterns expressed as specifications for synthetic regression fixtures. Representative cases now have synthetic service/API/UI regressions; the case catalogue remains broader than those executable tests.

## Implemented contracts

- [Reviewed pipeline workflow](reviewed-pipeline.md): source-level review/drill-down, generation routing, restricted MDX editing, task reconciliation, submissions and scoped agent feedback.

- [Implementation contract](implementation-contract.md): installation, runtime, and API boundaries.
- [Learning contract](learning-contract.md): existing materials, generation, versions, answer drafts, and Codex integration.
- [Course content graph](content-graph.md): current React Flow source/learning graph, grouping, semantics, and checks.
- [Script source comparison](source-comparison.md): original/result comparison, exact text provenance, legacy limitations, and validation.
- [Study MCP](study-mcp.md): read tools, scope, and connector behavior.
- [Mobile app](../mobile/README.md): native application development and current behavior.

For installation and local commands, start with the [repository README](../README.md). Implementations must update the relevant contract when accepted design becomes runtime behavior; a design document alone is not evidence that a capability is available.
