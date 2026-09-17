# Study Space documentation

Documentation belongs to this repository. Distinguish accepted target behavior from the implemented runtime contracts below.

## Getting started

- [Installation and setup](implementation-contract.md): installation, runtime, and API boundaries.
- [Learning workflow](learning-contract.md): existing materials, generation, versions, answer drafts, and Codex integration.

## Learning and content

- [Content and authoring model](content-authoring-model.md): accepted target for one `Inhalt` surface, view/edit mode, structure vs. rendered TOC, generic source placement, and the `Quellen` inventory.
- [Course preparation](reviewed-pipeline.md): source-level review/drill-down, generation routing, restricted MDX editing, task reconciliation, submissions and scoped agent feedback.
- [Structure editor](learning-structure-editor.md): separate script/tasks, drag sorting, reversible hiding and local display names.

### Sources and provenance

- [Content graph](content-graph.md): current React Flow source/learning graph, grouping, semantics, and checks.
- [Source comparison](source-comparison.md): original/result comparison, exact text provenance, legacy limitations, and validation.

## Architecture and development

- [Content pipeline](content-pipeline.md): source inventory versus learning structure, deterministic evidence, human/agent review, MDX script, separate tasks, precise mapping, drill-down, and update safety. Includes the implementation boundary and sequence.
- [Acceptance cases](content-pipeline-cases.md): eight observed course patterns expressed as specifications for synthetic regression fixtures. Representative cases now have synthetic service/API/UI regressions; the case catalogue remains broader than those executable tests.
- [Documentation export](documentation-export.md): publishing the project-owned documentation.

## Reference

- [Study MCP](study-mcp.md): read tools, scope, and connector behavior.
- [Mobile app](../mobile/README.md): native application development and current behavior.

For installation and local commands, start with the [repository README](../README.md). Implementations must update the relevant contract when accepted design becomes runtime behavior; a design document alone is not evidence that a capability is available.
