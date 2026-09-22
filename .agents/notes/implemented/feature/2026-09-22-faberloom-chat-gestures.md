# Agent Note: FaberLoom chat gestures address agents and run routines from the composer

Status: implemented

English | [中文](2026-09-22-faberloom-chat-gestures.zh.md)

## Problem

The product panels could create agents and routines, but the chat — the plan's primary entry — could not address either: `@` offered only files and sessions, and `/` offered only host commands. Invoking a routine meant leaving the conversation, and naming an agent in the text carried no gesture the user could discover.

## Decision

The gestures live in the FaberLoom surface plugin as trigger/command contributions over the existing seats, not as new host commands or a forked composer.

`packages/client/ui-faberloom/src/client/triggers.ts` registers, from `apply`:

1. An `@` `InputTriggerSource` named `agents` (ordered above files/sessions) whose candidates come from the workspace overview through `ctx.remote.faberloomView.overview()`, filtered to active agents and the live query, with the agent's space as the row description. A pick inserts plain `@name ` text; what the model receives is the name in the user's message, and delegation stays with the host's `faberloom_agents_delegate` tool.
2. A `/routine` `CommandContribution` (`popupSelect`) listing the owner's routines with their status badge; the select calls `faberloomView.startRoutine(id)`, the same Remote the Rutinas panel uses, so the run lands in the same execution service and in the Runs panel.

The overview read is cached for five seconds inside the gesture module because the candidates pass runs per keystroke. Both gestures read through the declared Remote namespace and write nothing client-side; a failed overview read serves the last good copy or an empty group, never an error card in the composer.

## Alternatives considered

- **A host command for routines.** Rejected: the host `ctx.commands` registry would log a `command/run` session event and need a client decoration anyway; the client `popupSelect` contribution reaches the same Remote the panel uses, keeps one behavior in one place, and costs no session-log vocabulary.
- **A reference chip with a codec for `@agent`.** Rejected for this slice: a chip would need a new reference kind and an open target; plain text keeps the gesture honest (the model sees exactly what the user typed) until an agent-addressed session mode exists.
- **A faberloom-owned `/` skill source.** Rejected: the host `ui-skill` source already lists the role catalog once the catalog parses (see the catalog-repair note); duplicating the group would show every skill twice.

## Consequences

- The `@` menu keeps files and sessions in their own group below the agents group; both sources coexist because uniqueness is `(trigger, name)`.
- `/routine` starts the run without leaving the chat, and the run is visible in Runs because the same execution service serves both entries.
- The gestures are unavailable in addressed subagent sessions, matching the model and skill sources' boundary.
- Agent naming with spaces inserts a multi-word `@name` as plain text; exact-match arbitration of such mentions is deferred until an agent-addressed session mode defines it.
