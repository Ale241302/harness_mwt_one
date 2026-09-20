# Agent Note: the agent's model policy and the board's reopening reach the panels

Status: implemented

English | [中文](2026-09-18-faberloom-model-policy-ui.zh.md)

## Problem

The model policy the plan describes — primary, exclusivity, ordered fallbacks, authorized escalation, shared budget, and a recommendation to fill it in — was implemented and covered (F24–F31) but invisible. `ctx.faberloomAgents` owned the pool, the resolver, and the recommender; the Agentes panel showed a read-only line with the primary model and one switch, so an owner could neither see the pool nor change any of the policy the engine resolves. The same gap left the Mesa unable to reopen a case: `board.reopen` existed with no way to reach it.

## Decision

The view exposes what the engine already owns, and the panel edits it.

`ctx.faberloomView` gains two reads and two writes:

- `models()` — the pool as plain rows (provider, model, capabilities, limits, rates, availability);
- `recommendModel(agentId)` — the recommender's answer for one agent: the recommended model, its ordered alternatives with cost-per-useful-result, evidence uses, provisional flag, and reasons, plus the uncertainty statements;
- `saveAgent` extends its policy patch with `fallbacks`, `escalation` (authorized models, conditions, `auto`/`manual`), and `budget` (per-execution amount, currency, attempt and escalation limits);
- `reopenBoardItem(id)` — the board's existing `reopen`, with the same read-only identity guard the other writes carry.

The Agentes inspector gains a **Modelo IA** block: a primary-model select drawn from the pool, the existing exclusivity switch, fallback and escalation checkboxes over the same pool, escalation mode and conditions, the budget fields, and a recommendation row — the suggested model with an *Aplicar* button, the alternatives with cost and evidence, and any uncertainty the recommender reported. The Mesa gains a *Reabrir* button beside approve and reject.

Every field is a plain JSON value at the Remote boundary and every read derives from the services at call time, so no state is mirrored in the panel.

## Alternatives considered

- **A separate model-pool screen.** Rejected: the pool exists to be assigned to an agent, and splitting it would make assignment a two-screen round trip.
- **Editing the policy as JSON.** Rejected: the plan's screens describe controls, and a text blob would push validation onto the owner.
- **Applying the recommendation automatically.** Rejected: the plan says recommending changes nothing by itself. The button is explicit, and the primary select stays the only place the value changes.
- **A correction flow on reopening.** Deferred with the teachings surface: today reopening returns the case to review, and linking the correction to a teaching needs the memory panels that are still dormant.

## Consequences

- An owner sees the whole policy a routine will use and can change it; the resolver keeps deciding at execution time.
- The recommender's uncertainty is visible where the choice is made, so a pool without rates or evidence says so instead of implying a cheapest model.
- Reopening returns a reviewed case to the board; nothing re-runs automatically, and the history of the previous review stays.
- The hidden per-execution sessions still use the deployment's default model: applying a policy to the agent-run path is separate work.
