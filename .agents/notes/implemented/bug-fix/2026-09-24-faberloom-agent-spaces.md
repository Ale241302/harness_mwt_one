# Agent Note: an agent's spaces are listed by name, and there may be several

Status: implemented

English | [中文](2026-09-24-faberloom-agent-spaces.zh.md)

## Problem

The Agentes panel's SPACE column rendered the raw space id, so an agent leading a space showed a UUID instead of the space name, and the overview collapsed every agent to a single space even though the model already lets one agent lead several spaces (a parent and its sub-spaces).

## Decision

`FaberLoomAgentRow` carries `spaceIds: readonly string[]`, and the panel resolves each id to its space title.

- `overview()` builds `spacesByAgent` from every space's `agentId` instead of the first only, so an agent's complete set is reported.
- The Agentes panel maps ids to titles from `overview.spaces` and shows them joined by `, `, falling back to the personal label when the agent leads none.
- The `@` agent trigger resolves the same list for its description.

## Alternatives considered

**Keep `spaceId` and add a `spaceName`.** It fixes the UUID but still hides that an agent can lead several spaces; reporting the ids keeps the cardinality honest.

**Resolve the title only in the client store.** The panel already reads `overview.spaces`, so the map belongs there; the view keeps ids.

## Consequences

- An agent leading more than one space shows every space name in the panel and the `@` trigger.
- `FaberLoomAgentRow.spaceId` became `spaceIds`; the view and client tests use the new field.
- Selecting an agent from the `@` gesture still inserts the agent name, unchanged.

## Testing

`packages/faberloom/view/tests/workspace-board.spec.ts` asserts `overview.agents` reports `spaceIds: ['sp1']`; `packages/client/ui-faberloom/tests/gestures.client.spec.ts` and `registration.client.spec.tsx` carry the new field.
