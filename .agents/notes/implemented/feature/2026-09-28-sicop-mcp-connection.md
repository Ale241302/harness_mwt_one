# Agent Note: the harness connects the SICOP MCP for every user

Status: implemented

English | [中文](2026-09-28-sicop-mcp-connection.zh.md)

## Problem

Every `dsh` starts with the MWT.ONE MCP server because the gateway's per-user patch inserts it (`mcp-mwt`, `serverName: mwt`). A second source of truth, SICOP — Costa Rica public-procurement open data exposed as an MCP server — is reachable at `https://sicop.vlinte.work/mcp` with no authentication. Owners asked to query it from their agents and skills, and the Agents panel offered only the single MWT.ONE MCP switch.

## Decision

- The gateway config gains `sicopUrl` from `SICOP_MCP_URL`, defaulting to `https://sicop.vlinte.work/mcp`. `renderPatch` inserts an `mcp-sicop` entry (`serverName: sicop`, streamable-http, no headers) for every user, so SICOP is available to any agent or skill by default. Setting `SICOP_MCP_URL` empty omits the entry. `GET /healthz` reports `sicopConfigured`.
- `renderEntry` emits the `headers:` block only when at least one header exists, because an empty `headers:` parses as `null` and the MCP client schema expects a dictionary.
- The agent catalog gains `sicopMcp` (default `true`), carried through the durable record, service types, the `createAgent`/`saveAgent`/`agentDetail` remotes, and the Agents panel checkbox, mirroring `mwtMcp`. The checkbox copy is locale-owned in Spanish, English, and Chinese.
- A shared skill `skills-shared/sicop-contratacion-publica/SKILL.md` teaches the SICOP tool set, the measurement-level, coverage, and currency rules, the known MCP-server defects, and the response envelope (`nivel_medicion`, `cobertura_cruce`, `moneda`, `caveats`). It folds in the query-relevant rules of the extraction skill (`skills-catalog/sicop/SKILL.md`, `sicop-extraccion`), which stays the deep reference for parsing the Observatorio ZIPs and links back to it. It reaches every role because the gateway mounts `SKILLS_SHARED_ROOT` beside the role catalog.
- The gateway's workspace instructions (`FABERLOOM_INSTRUCTIONS` in `gateway/server.mjs`) require every agent to load `sicop-contratacion-publica` before using any `mcp__sicop__*` tool, so the skill activates by default instead of only when the model matches a catalog description.
- A shared agent preset `agents-shared/sicop-analyst/` (`preset.yml` + `agent.cordis.yml`, persona, file/search/web/skill rows) seeds an "Analista SICOP" agent. `PRESET_CURATION` assigns it the `sicop-contratacion-publica` skill, and its persona requires loading that skill before any query. `seedSharedAgents` re-syncs shared presets on every instance start, so the agent reaches owners provisioned by earlier deployments, not only new ones.
- `docs/endpoints.md` (with its Chinese pair) lists the public SICOP endpoint.

## Alternatives considered

**Make `sicopMcp` (and `mwtMcp`) filter MCP tools per agent.** The harness mounts MCP tools globally; a faberloom agent carries no runtime tool filter, so honoring the flag would require a new composition seam and would change the shipped MWT.ONE behavior. The two switches stay stored per-agent metadata, exactly as `mwtMcp` is today.

**Authenticate SICOP like MWT.ONE.** SICOP is a public read-only server with no identity: sending per-user headers would imply an authorization the server does not enforce.

**Hardcode the SICOP URL in `renderPatch`.** The deployment needs to point at a staging or local SICOP without a rebuild, so the URL is a validated `Config` value changeable from `.env`.

## Consequences

- Any user's agents and skills can call the `mcp__sicop__*` tools (`sicop_ficha_proveedor`, `sicop_mercado_familia`, `sicop_producto_historia`, and the rest) without per-user setup.
- The `sicop-contratacion-publica` skill and the "Analista SICOP" agent appear in the Skills and Agentes panels for every owner on the next start; a new owner gets both without a manual step.
- Disabling SICOP for the whole deployment is one empty `SICOP_MCP_URL`; there is no per-user switch, matching the "any user may use it" requirement.
- The Agents panel shows a "Connect to the SICOP MCP" switch beside the MWT.ONE one. It records the intended access per agent but does not restrict tools at runtime, the same current limitation as `mwtMcp`.

## Testing

`packages/faberloom/agents/tests/agents.spec.ts` asserts `sicopMcp` defaults on and toggles independently of `mwtMcp`. `packages/faberloom/view/tests/workspace-board.spec.ts` asserts `saveAgent` forwards `sicopMcp`. Host and Client typechecks pass, the `ui-faberloom` registration spec passes, and `verify-skills-catalog` accepts the new shared skill.
