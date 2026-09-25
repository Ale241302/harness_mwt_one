---
name: grill-me-lite
description: A lightweight exploratory pass that steers before acting without a question barrage. Use when a request is broad or a Space opens from an email with no explicit instructions, when the user says "grill me lite", "grill lite", "explora", "orienta", or "encauza", or when a full interview would be overkill. Ask at most one question and only when a wrong guess would waste work; otherwise restate the aim, name the most likely intent, and propose the next concrete step for a quick yes/no.
---

# Grill Me Lite

A low-friction counterpart of `interview-me`. Where `interview-me` runs a one-question-at-a-time interview until it can predict the user, this pass does the minimum it takes to point the work in the right direction without spending the user's patience.

## When to use

- A Space or session opens from an email or a one-line context with no explicit ask.
- The request is broad ("organiza esto", "mira este correo") but action is plausible now.
- The user explicitly invokes: "grill me lite", "grill lite", "explora", "orienta", "encauza".
- A full interview would be overkill: the intent is probably clear and only the first step is in doubt.

Use the full `interview-me` only when the ask is genuinely underspecified and a wrong build would be expensive.

## How it works

1. **Restate** what you have in one line, so the user can see you understood the context.
2. **Name the most likely intent** in one line ("Por lo que veo, quieres X").
3. **Ask at most one question**, and only when the answer changes what you would do. When two options are close, put your recommendation first and make it a yes/no. Never ask what you can infer from the context or find yourself.
4. **Propose the next concrete step** and stop. If the user already gave a direction, skip the questions and do the step.

## Budget

- At most **one** question per turn, and at most **one** clarifying round before you act.
- Surface only the one decision that unblocks the first step, not every open question.
- If you can proceed safely with a stated assumption, state it and proceed.

## Contrast

- `interview-me` (grill me): deep, one question at a time, until ~95% confidence, before any plan.
- `grill-me-lite` (this): a single steer, then move.

## Do not

- Do not turn this into a checklist of questions.
- Do not ask for information already present in the context, the workspace, or the tools.
- Do not block progress when a reversible first step exists; take it and confirm.
