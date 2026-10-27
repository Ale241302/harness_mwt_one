---
description: "Native product defaults (ctx.faberloomDefaults): the agents and routines FaberLoom seeds for a new owner from the product plan, with only the skills the owner's role ships; for users and maintainers of the FaberLoom Agentes and Rutinas modules."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-defaults

English | [中文](README.zh.md)

## Summary

The defaults service gives a new owner a working starting point instead of empty panels: the agents and routines the product plan works through, created once and then owned by the panels. It assigns an agent only the skills the owner's role actually ships, and it leaves the seeded routines in `draft` so nothing runs before the owner activates it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.faberloomAgents` and `ctx.faberloomRoutines` are present, with the deployment's identity: `ownerId`, `role`, `readOnly`, and `skillsCatalogRoot`. The service seeds on activation.

The catalogue is the plan's own worked example: the agent roster from the agents screen (`Recepción`, `Revisión de pedidos`, `Proformas`), plus the privileged-role `Operador Marluvas` agent that carries the ten `marluvas-*` skills. The routine `Pedido a proforma` exercises a real agent turn, an MCP operation, and a wait for the review before the case is closed.

Seeding is scoped to one owner home by a marker at `<DSH_HOME>/faberloom-defaults.json`:

- a pass does nothing for a read-only identity or an empty owner;
- an item whose name already exists is left alone, so a retry after a partial pass never duplicates it;
- an entry with `roles` reaches only those roles; `Operador Marluvas` is limited to `admin`, `superadmin`, and `ceo`;
- when a newer catalogue adds an agent, the pass creates only the names the marker does not already record, so an upgrade adds the new agent while a name the owner deleted stays deleted;
- the deployment's baseline agents are collapsed to one row per name before the pass: two installations of the same catalogue can each seed the same name under different ids, a stored provider key wins the keeper, and the keeper absorbs every skill and connected agent of its group; an unseeded, ownerless agent with a baseline name and the same responsibility is a copy another home carried here and is removed; an agent the owner created with the same name and its own responsibility is never touched;
- the deployment's provider and model reach a baseline agent until its owner picks others: `<DSH_HOME>/faberloom-baseline-applied.json` records the pair each pass applied, and a differing current pair is left alone;
- a successful pass writes the marker, including one that found nothing left to create, so the next boot never resurrects an item the owner deleted; a pass that throws leaves no marker and no claim, so the next start retries.

Two starts can begin at once for the same home, and each reads the other's domains before either flushes. A pass therefore claims `<DSH_HOME>/faberloom-defaults.claim` with an exclusive create first: the winner seeds, the loser reports `another pass is seeding`, and a claim left behind by a pass that died is cleared after ten minutes so the next start retries.

Skills are matched against what exists — the owner's own uploads under `<DSH_HOME>/skills` and the role's catalogue under `skillsCatalogRoot/<role>` — and a declared skill the role does not ship is simply not assigned.

With `globalAgentsFile` set to a file every home of the deployment shares, a pass every `globalAgentsIntervalMs` (`src/global.ts`) makes an Admin/CEO edit of a baseline agent the deployment's edition: a privileged home whose baseline agent changed since its last pass publishes its settings and provider key with the next revision, and every home applies an edition newer than the revision it records in `<DSH_HOME>/faberloom-global-agents.json`. A home's first pass only records what it holds. Mail connections stay out of the edition because they name each user's mailboxes.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing at seeding time. The rows the pass creates through `ctx.faberloomAgents.createAgent` and `ctx.faberloomRoutines.createRoutine` become model-visible only through the agents and routines tools, exactly as if the owner had created them by hand.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the service never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The catalogue is fixed in source.** Changing what a new owner receives means editing `src/catalog.ts`; there is no deployment-supplied catalogue file yet.
- **Role-gated entries are silent for other roles.** `Operador Marluvas` is not created for a role outside `admin`, `superadmin`, or `ceo`, even when the deployment ships the `marluvas-*` skills.
- **The live mail routine is provisioned elsewhere.** This package only seeds the agent; `@deepseek-ai/dsh-faberloom-inbound` and `@deepseek-ai/dsh-faberloom-view` create and activate the built-in routine once the owner has a mailbox.
- **Seeding is keyed by owner home, not by identity.** Two deployments that share a home would share one marker.
- **A pass runs once per process.** The service caches its own promise, so a marker removed while the process lives changes nothing; bringing a deleted seeded item back means removing the marker and restarting the process, which re-runs the pass.
- **A seeded routine is never activated automatically.** It stays `draft`, including its trigger, so a mail-driven routine cannot run until the owner activates it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The pass runs through the product services rather than writing storage rows, so a seeded agent and routine carry the same validation, versioning, and identity as one created in a panel. `seed()` caches its own promise, so the activation call and any later caller observe one pass.

</details>

**Runtime invariant:** No companion is published. The service holds no derived state: the marker on disk and the two product domains are the only state, and the pass reads them at call time.
