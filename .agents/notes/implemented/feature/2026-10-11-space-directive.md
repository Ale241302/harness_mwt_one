# Agent Note: The Space agent directive

Status: implemented

English | [中文](2026-10-11-space-directive.zh.md)

## Problem

A Space named its responsible agent, its context, its commercial sources, and its workspace, but nothing let the owner write instructions **for that Space**: "here we answer in Spanish with the client's part number", "always check stock before quoting", "never send a price without the margin". Those live in the owner's head or in a note the agent never reads. The only per-deployment prompt a Space had was the `Directiva MWT` line generated from its sources, which pins the console lookup and nothing else.

## Decision

A Space record carries an owner directive, and the Space's session injects it.

- **Durable field.** `faberloom-spaces` adds `prompt: z.string().default('')` to `SpaceRecord`, `FaberLoomSpace.prompt`, and `CreateSpaceInput.prompt` / `UpdateSpaceInput.prompt` (`null` clears it). The default keeps the domain version and every record written before the field loading unchanged.
- **Remote surface.** `faberloom-view`'s `spaceDetail` returns the directive and `saveSpace` accepts it (`SpaceSaveInput.prompt`), so the existing detail/save path carries it without a new Remote.
- **Session composition.** `faberloom-session-agent` reads the directive from the Space it already resolves and, when non-empty, injects a `faberloom:space-directive` system-prompt section ordered just after the persona and before the skills line. An empty directive injects nothing, so a Space without one reads exactly as before.
- **Panel.** The Espacios detail gains a **directive** textarea, loaded from the detail and saved with the title, inheritance, members, and agent.

The directive is the **Space owner's** text for the Space's agent, distinct from the agent's own `responsibility` (its persona) and from the generated source directives: it composes with both rather than replacing either.

## Alternatives considered

**Reuse the Space `context` entries.** Rejected: context is shareable, published to the console when the Space is shared, and keyed for retrieval; an instruction to one's own agent is neither. Mixing them would leak an internal directive the moment the Space travels.

**Put it on the agent (`responsibility`).** Rejected: an agent leads several Spaces (a parent and its sub-spaces, and the same specialist across clients), so one agent-scoped prompt cannot say different things per Space.

**A new Remote instead of extending `spaceDetail`/`saveSpace`.** Rejected: the detail already carries every editable field and the save already patches them; a separate call would split one editing surface across two round trips and two revision cursors.

**Inject it as a user message at session start.** Rejected: it is standing instruction, not a turn; a system-prompt section keeps it out of the transcript, survives compaction, and cannot be mistaken for something the user said.

## Consequences

An owner can state how a Space's agent must behave, and the Space's sessions follow it without editing the agent. The directive is per Space, so the same specialist behaves per client. An empty directive changes nothing, and the injection is additive, so existing sessions and every seeded agent keep working. The directive is owner-scoped: it lives in the Space record and is not published by sharing (only context, memory, and Work Flows travel).

## Testing

`packages/faberloom/spaces` covers the record round-trip and the `prompt` update through its existing suite. `packages/faberloom/session-agent/tests/session-agent.spec.ts` asserts the injected `faberloom:space-directive` section carries the Space's text, and that an empty directive leaves only the persona. `packages/faberloom/view` covers the detail projection and the save input, and the `ui-faberloom` panel suite renders the Spaces detail over the stubbed view.
