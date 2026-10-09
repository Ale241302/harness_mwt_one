# Agent Note: Durable Space consultations

Status: implemented

English | [中文](2026-10-08-space-consultation-runtime.zh.md)

## Problem

`faberloom_spaces_ask` was one-shot: a caller could ask a Space's agent a single question and nothing recorded the conversation. A caller that wanted a second turn shared the whole brief again, and the view had no way to tell which Spaces had a live consultation.

## Decision

Add the domain `faberloom_agent_runtime` and its package `@deepseek-ai/dsh-faberloom-agent-runtime` with the service `ctx.faberloomAgentRuntime`. It holds one durable row per owner, Space, and caller session — the caller's child session and a label — and exposes `record`, `consultation`, `listForSpace`, and `remove`. `faberloom_spaces_ask` gains `continuable: true`: it establishes a durable child through `ctx.subagents.startContinuable`, records the consultation, and returns the child id with `stopReason: 'continuable'`. A new tool `faberloom_spaces_followup` reads the caller's recorded consultation and sends one more message to the same child through `ctx.subagents.sendMessage`. The view exposes `spaceAgentRuntime(spaceId)`, mapping each recorded row to a client-safe row so a panel can report a Space's live agents.

## Alternatives considered

**Keep every consultation one-shot.** Rejected: a follow-up should continue the same child so the Space agent keeps its turn, not re-receive the whole brief.

**A durable cross-process mailbox for the Space agent.** Rejected for this slice: the subagent seam has no durable mailbox or lease, so residency is process-local; the recorded child is addressable while its process holds the parent, and a cross-process resident waits for that seam work.

**Record the consultation in `spaces`.** Rejected: it is a runtime fact about sessions, not space configuration, and the view and tools read it independently.

## Consequences

A caller session can hold a multi-turn consultation with a Space agent and continues it by child id; a second continuable ask from the same caller and Space replaces the first child, so the caller holds one durable consultation per Space. `followup` returns acceptance, not the reply: the answer lands in the child's session and reaches the parent as the subagent settlement notice, which is the seam's model for adjacent-agent messaging. The runtime service is optional in `spaces_ask` and the view (`ctx.get`), so a deployment without it keeps one-shot consultations and an empty runtime panel.

Tests cover the runtime service (record, read, list, remove, upsert preserving the creation instant), the continuable ask (start, record, no one-shot run), the follow-up (send to the recorded child, and the refusal with no recorded consultation).
