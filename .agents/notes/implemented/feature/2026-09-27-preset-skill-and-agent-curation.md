# Agent Note: curated skills and connected agents for the shared presets

Status: implemented

English | [中文](2026-09-27-preset-skill-and-agent-curation.zh.md)

## Problem

The 35 shared agent presets under `agents-shared/` ship only a `preset.yml` (name, description, order) and a generated `agent.cordis.yml`. That composition is the shipped `standard` preset with the generic persona prefix: it carries no agent body, no concrete skill names, and no team. Those live in the upstream ECC catalog, which this repository does not vendor, and there is no generator here. So a seeded preset agent started with no skills and no connections, and nothing in the repository could derive them.

## Decision

The skills and the working partners are authored, not extracted, in `packages/faberloom/defaults/src/preset-curation.ts`, keyed by the preset's directory id under `agents-shared/`.

- `skills` lists real skill names from `skills-shared/`; the seeder keeps only those the deployment actually ships (the role catalog, the shared catalog via the new `skillsSharedRoot`, or the owner's uploads).
- `connects` lists other preset directory ids; the seeder resolves them to the seeded agents by name and writes them as the agent's `subagents`.
- A preset agent created now starts with its curated skills and connections. An agent an earlier deployment seeded has the curated skills merged in (a union that keeps whatever it already had) and receives its connections only when it declares none of its own, so an Admin's choices survive a restart.
- The gateway passes `skillsSharedRoot` to `faberloom-defaults` so availability sees the curated shared catalog.
- The three native seed agents also declare `connects` (Recepción → Revisión de pedidos → Proformas) and list both the role's `mwt-compras-*` skills and the equivalent `mwt-admin-*` ones; the seeder keeps the ones the owner's role actually ships, and on a restart merges the catalogue's skills into an agent a previous deployment seeded.

## Alternatives considered

**Put `skills`/`connects` in each `preset.yml`.** That file feeds the session-preset metadata reader and describes the dsh agent preset; the skills and team belong to the FaberLoom agent catalog seeded from it. Keeping the curation in one reviewed map avoids two owners for one fact and leaves the shipped preset format untouched.

**Derive them from the external ECC catalog.** The catalog is not vendored and there is no generator in the repository, so a build step would have to fetch a moving external source. Authoring the map is the honest option.

## Consequences

- Every seeded preset agent starts with a few real skills and points at the agents it works with; the graph is acyclic by construction (`chief-of-staff` → specialists, `code-reviewer` → simplifier/security, the GAN and open-source chains in order).
- A skill name in the map that the deployment does not ship is dropped silently, and a partner preset that is not mounted is not connected, so a partial deployment stays consistent.
- The map is content: changing an agent's skills or team is editing one file, and a validator can check every name resolves.

## Testing

`packages/faberloom/defaults/tests/defaults.spec.ts` seeds a `code-reviewer` preset with a shared skills root and asserts the agent's `skills` are exactly the curated-and-available set and its `subagents` name the mounted `security-reviewer`. A repository check confirmed all 35 map entries name real `skills-shared/` skills and real `agents-shared/` preset ids.
