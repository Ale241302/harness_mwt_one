# Agent Note: FaberLoom seeds a plan-derived agent roster and routine per owner

Status: implemented

English | [中文](2026-09-18-faberloom-defaults.zh.md)

## Problem

A new FaberLoom owner met four empty panels: nothing told them which agent to create, which skills to attach, or what a routine looks like. The product plan and the screen schemas already answer those questions with a worked example — a three-agent roster and the `Pedido → proforma` routine — but nothing carried that example into a fresh workspace, and the plan explicitly warns against filling the catalogue automatically per task.

## Decision

`packages/faberloom/defaults` owns the initial content. It mounts where `ctx.faberloomAgents` and `ctx.faberloomRoutines` are present, takes the deployment identity (`ownerId`, `role`, `readOnly`, `skillsCatalogRoot`), and seeds once on activation.

The catalogue is `src/catalog.ts`, taken from the plan: the agents screen's roster (`Recepción`, `Revisión de pedidos`, `Proformas`) and the routine screen's `Pedido a proforma`, whose four steps exercise the three shipped handlers — an `agent` turn, an `mcp` operation, and a `wait` for the review that closes the case. Seeded routines stay `draft`, so a mail-driven trigger cannot run before the owner activates it.

Three rules keep the pass safe to repeat and safe to skip:

- **The role decides the skills.** An agent receives a declared skill only when the owner's own uploads under `<DSH_HOME>/skills` or the role catalogue under `skillsCatalogRoot/<role>` actually ships it; the deployment's skill catalogue stays the single source, so nothing is copied.
- **Name matches before creation.** An item whose name already exists is left alone, which makes a retry after a partial pass idempotent without a transaction.
- **One marker per home.** `<DSH_HOME>/faberloom-defaults.json` is written only by a pass that created something, so a later boot neither duplicates nor resurrects an item the owner deleted.

The pass goes through the product services rather than writing storage rows, so a seeded agent and routine carry the same validation, versioning, and identity as one created in a panel.

## Alternatives considered

- **Seed on first panel read.** Rejected: a read that writes surprises the caller and would race two open panels.
- **Seed whenever a name is missing.** Rejected: it resurrects what the owner deliberately deleted.
- **Ship the catalogue as a deployment file.** Rejected for now: the plan's example is product content, and a file would need a schema, validation, and a second review path; the deferral is recorded in the package README.
- **Copy the role's skills into the owner's own skills folder.** Rejected: the profile already exposes the role catalogue as native skills, and duplicating it would double every skill in the panel.
- **Activate the seeded routine.** Rejected: a trigger that starts sending mail-driven work without the owner's decision is the opposite of a safe default.

## Consequences

- A fresh owner sees one routine in `draft` and three agents, each already carrying the skills their role ships.
- Changing what a new owner receives means editing `src/catalog.ts`; there is no deployment-supplied catalogue yet.
- The marker is keyed on the owner home, so two deployments sharing a home share one marker.
- The plan's roster is a starting point, not a business policy: every seeded value is editable in the panels, and the plan's "do not fill the catalogue automatically" rule still holds for everything the agent does later.
