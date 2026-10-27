# Agent Note: Owner choices survive restarts, skills are editable, and runs read in plain language

Status: implemented

English | [中文](2026-10-27-owner-choices-skill-editing-and-run-list.zh.md)

## Problem

Four gaps showed up in one working session on the Marluvas operator.

The defaults seeder set the deployment's provider and model on every baseline agent on every start ([agent ownership](2026-09-27-agent-ownership-and-permissions.md)). An owner who switched `Operador Marluvas` to another provider and pasted that provider's key saw the next gateway restart put the deployment provider back, while the new key stayed: the agent was left calling one provider with another provider's key.

The skill detail dialog was read-only, so a skill could only be replaced by uploading a whole `.md` file, and it listed the agents that use the skill as eight-character id prefixes.

The routine executions list printed every run as one dense row: a raw status token, the version, a step selector, and the step text clipped to a few lines. Runs were in storage order, carried no date or trigger, and showed engine failures verbatim (`routine … version 118 not found`, `agent … not found`, a provider's JSON quota error).

A gateway restart answered a few panel calls with its HTML page, and the panel showed `Unexpected token '<'` as an operation failure, including for its own five-second background refresh.

## Decision

**A baseline agent follows the deployment until its owner picks a provider or model.** `faberloom-defaults` records in `DSH_HOME/faberloom-baseline-applied.json` the provider/model pair it applied to each baseline agent id. On a later start, an agent whose current pair differs from the record was edited by its owner, and the pass leaves its provider and model alone. An agent with no record converges once, as before. The pass runs again after seeding so the agents created in that pass are recorded. The API-key rule is unchanged: the deployment key is written only when no key is stored.

**Any skill except an incoming share opens in an editor.** The view adds `skillMarkdown(name)`, which returns the SKILL.md the list shows (the owner's copy first, then the shared or role catalog). Saving goes through the existing `saveSkill`, so editing a role or shared skill writes the owner's copy under `DSH_HOME/skills`. The row reports `replacesCatalog: true` for such a copy, and deleting it is labelled as restoring the catalog version. For the copy to win at run time as well, the owner's skills directory is now the first `customSkillDirs` entry of the `faberloom-role` skill provider on the desktop and on the gateway: within one provider the first directory wins a duplicate name.

**The skill row names its agents.** `FaberLoomSkillRow.assignedNames` carries the agent names in the order of `assignedTo`, and the dialog shows names.

**Runs read newest first, with the trigger and a plain-language outcome.** Each run shows a localized status word in the state colour, the start date, `done/total` steps and the version, the subject of the event that started it, and the first line of the latest step text. Known engine failures (a missing routine version, a missing agent, an exhausted provider balance or quota) show a sentence that names the cause and the next action; the raw text stays in a collapsed per-run section with every step, the cancel-effect action for completed effect steps, and Reconcile for runs that need review, failed, or wait. The list shows ten runs and offers the rest on request.

**A server that did not answer reads as such.** `Feedback` maps an HTML response, a JSON parse failure on `<`, and a network rejection to one message saying the server did not answer and nothing was lost. The background overview refresh no longer marks an error once rows are shown; the next poll retries.

## Alternatives considered

Dropping the provider/model convergence entirely would leave agents seeded by an earlier deployment on a provider the deployment no longer pays for. Comparing against the deployment default alone cannot tell an owner's choice from a stale default.

Writing an edited role skill back into the role catalog would change it for every user of that role and be overwritten by the next deploy.

## Consequences

An owner's provider or model choice on a baseline agent now persists across restarts and deploys; changing the deployment default no longer reaches that agent. The record file is per home and keyed by agent id.

The run list no longer exposes a step selector; the actions moved into each run's step list.

## Verification

- `packages/faberloom/defaults/tests/defaults.spec.ts`: an owner's provider and model on a baseline agent survive a restart with the deployment defaults configured; the existing convergence of an unrecorded stale value still passes.
- `packages/faberloom/view/tests/workspace-board.spec.ts`: a role skill lists its agent names, reads through `skillMarkdown`, and after `saveSkill` becomes an owner copy with `replacesCatalog`; an unknown name is rejected.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: the skill dialog names the agent, opens the editor with the catalog hint, and saves the edited text; the run list orders runs newest first, shows the trigger subject, the review status, the plain-language missing-agent cause, and the summary line, and Reconcile appears only for the run under review.
