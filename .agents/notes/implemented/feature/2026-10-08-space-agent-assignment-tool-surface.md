# Agent Note: Space agent assignment and capability flags on the tool surface

Status: implemented

English | [中文](2026-10-08-space-agent-assignment-tool-surface.zh.md)

## Problem

The F50 smoke on the deployed harness showed the agent-to-Space assignment and the per-agent capability plane were unreachable from the model surface. `faberloom_spaces_update` accepted the assignment keys and returned success, but its declared parameters carried no `agentId`, so the argument was discarded and only the version advanced; `faberloom_spaces_reference` then reported no responsible agent and `faberloom_spaces_ask` failed with "este Space no tiene un agente responsable". Likewise `faberloom_agents_create` and `faberloom_agents_update` did not expose `mwtMcp`, `sicopMcp`, or `webAccess`, so an agent created through the tools always kept the service defaults (`mwtMcp: true`) with no way to narrow its plane. The owning service already accepted every one of these fields; only the tool schemas and their argument plumbing were missing.

## Decision

Add the optional `agentId` parameter to `faberloom_spaces_update` (an empty string clears the assignment, mapping to the domain's `null`) and forward it in the space patch. Add the optional `webAccess`, `mwtMcp`, and `sicopMcp` parameters to `faberloom_agents_create` and `faberloom_agents_update` and forward each present value into the owning service call. The tool catalog and its Chinese pair record the new parameters and the widened `faberloom_spaces_update` description.

## Alternatives considered

**Assign only from the Web console.** Rejected: the same capability must be reachable from every consumer the Service Definition serves; leaving it UI-only is the defect the smoke found, not a boundary.

**Infer the responsible agent from the Space's context.** Rejected: assignment is an owner action with an explicit target, not a derived value.

## Consequences

An agent created through the tools can set its MWT/SICOP-MCP and web flags, and a Space can name its responsible agent through `faberloom_spaces_update`, so `faberloom_spaces_reference` shows the agent and `faberloom_spaces_ask` delegates without an override — the F50 path is reachable end to end from the model surface. The tool-faberloom specs pin the forwarded `agentId` (set and clear) and the three plane flags on both create and update.
