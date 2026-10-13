# Agent Note: A message that names an agent runs its turn on that agent's route

Status: implemented

English | [中文](2026-10-12-mentioned-agent-runs-the-turn.zh.md)

## Problem

A Space session already ran as its responsible agent — persona, tool mask, skills, and, when the agent was routed and keyed, its provider, model, and API key — and a user could name a catalog agent in a chat: the shipped `faberloom:mentions` instruction told the model to act as that specialist, and the `@` picker inserted the `@Name` text. Neither changed which account served the turn. A message that named an agent still ran the whole turn on the session's own route, so it could not run on the named agent's model or bill that agent's provider account, which is the turn's own account the owner asked to change.

## Decision

**A message that opens with `@Name` runs its turn on that agent's route.** `packages/faberloom/session-agent` gains the per-turn route in `src/mention.ts` (the pure `latestUserText` and `matchMentionedAgent` helpers) and a listener pair in `src/index.ts` (`attachMentionRoute`). A turn whose latest user message opens with `@`, then a catalog agent's exact name, then whitespace or the end of the text carries that agent's provider, model, and [credential reference](../architecture/2026-10-12-agent-credential-route.md); the longest matching name wins, so a name that is a prefix of another does not shadow it. The rule is the syntax the shipped `faberloom:mentions` instruction and the `@` picker already use.

**The mention is read from `agent/pre-step` and applied on `agent/request`.** `agent/pre-step`'s payload carries the message batch claimed for the step; `agent/request`'s payload carries no messages, and the loop commits the claimed batch to the log only after the preparation waterfall, so a request listener alone could not read the turn's user text. The request listener is registered `{ prepend: true }` so it runs outermost, and it applies the mention's route to whatever the rest of the chain resolved.

**A mention-free turn restores the route the session used before the mention, and only while the logged route is still the mention's.** The loop logs the header the request used, so a mentioned turn would otherwise become the session's seed route; the listener keeps the base route it captured before the first override and reapplies it on the next mention-free turn, so consecutive mentions all restore the session's own route. A route the session changed in between — an explicit model selection — no longer equals the mention's, so the restore does not win and that selection stays in force. An unknown name, a missing catalog or plane, or an agent without all of a provider, a model, and a key resolves to `undefined`, leaving the request exactly as the chain resolved it rather than failing the turn.

**What is durable and what is not.** The mention lives in the user message text that is logged anyway, and the loop's own `request/header` records the provider and model the request used — the reconstructability rule for model-visible input. The credential reference is request state: it reaches the adapter and never the log.

## Alternatives considered

**Reading the mention from the session's derived messages inside the request listener.** The request listener is where a route rewrite naturally sits, but on a turn's first request the claimed batch is not yet in the derived messages — the loop commits it to the log after the preparation waterfall — so it would read the previous turn's message. Reading at `agent/pre-step` sees the batch the step claimed.

**A durable model selection per mention.** Recording the mentioned route in the session log would survive a restart, but it puts request state in the durable projection, which the platform rule forbids: the log carries what is reconstructable, and a credential reference is not.

**Making the mention a tool call instead of a route.** A tool call would keep the turn on the session's own account and only consult the named agent, which is exactly the turn's own account the owner asked to change.

## Consequences

A message that names a catalog agent now runs its whole turn — every step of it — on that agent's provider, model, and key, and the turn after it returns to the session's own route. The mention fails nothing: a name that matches no catalog agent, a missing catalog, or a route missing any of provider, model, and key leaves the request untouched. The key reference is never written to the log, and an explicit selection the user makes after a mention stays in force.

One limit is accepted. The restoration is process-local: the listener remembers the pre-mention route in memory, so after a restart a session whose last request was a mention keeps that agent's route until another mention replaces it. Making that survive would need a durable route intent that is not the request header, which the requirement forbids.

Verification: a loop spec drives the real agent loop and asserts that a mentioned turn reaches the adapter on the named agent's route while the session log carries the mention text and no credential reference, that a turn without a mention and the turn after a mentioned one stay on or return to the session's route, that consecutive mentions each run on their named agent and then restore, that a route the session changed after a mention stays in force, that reasoning effort restores with the route, that a mentioned turn keeps its route across steps, and that an unknown name, an unrouted or unkeyed agent, a missing catalog, injected-context text, and a step with no user text all change nothing.
