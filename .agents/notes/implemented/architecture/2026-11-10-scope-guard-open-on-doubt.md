# Agent Note: Scope guard refuses only a confident personal request

Status: implemented

English | [中文](2026-11-10-scope-guard-open-on-doubt.zh.md)

## Problem

The guard shipped by [the 2026-11-02 note](2026-11-02-byok-composition-shared-key-guard.md) refused every turn whose classification was not a confirmed `work`: `scopeFallback` defaulted to `refuse`, a `work` verdict needed 0.80 confidence, and a second call framed as the opposite question had to answer `work` as well. Read together, those rules turned the classifier's hesitation into a refusal the user could do nothing about. A B2B account asking "dame información de la 2487-2026" or, one message later, "de esta PO 505244" — a case number and a purchase-order number, the two shortest ways these users name a record — received "No pude verificar si este pedido entra en el alcance de la llave compartida de FaberLoom" twice and no answer at all.

The classifier had no conversation: it saw one line, a bare number, and no Space context beyond the Space title. It answered with low confidence, and the 0.80 floor converted that doubt into a refusal. The same refusal appeared when the classifier call failed, when it ran on a reasoning route whose 64-token budget the hidden tokens consumed before any JSON, and when the confirmation call disagreed.

## Decision

The guard now refuses only what a classifier positively calls personal. Three rules produce that.

A message that names only a business record is work, decided without a model call. `isWorkReference` reads one to eight tokens built from a leading asking or filler word, record nouns (`pedido`, `expediente`, `caso`, `PO`, `PF`, `OC`, `SAP`, `factura`, `proforma`, `contenedor`, `guia`, `envio`, `tracking`, …), and at least one identifier — a number or a number behind a one-to-four-letter prefix, as in `2487-2026`, `505244`, `PF-1234`, `OC/1234`. Anything else fails the rule, so `poema 505244`, `hacé la tarea 12`, and `necesito el estado del pedido 505244 de Sondel` still reach the classifier. A turn that passes carries nothing a personal request could use: the model can only look the record up.

`scopeWorkConfidence` defaults to 0.50 and bounds both directions. A `personal` verdict at or above it refuses with the personal text; below it the answer is a doubt. A `work` verdict at or above it spends the shared key after the confirmation call, and only a confident `personal` answer there refuses — the second call is a check on a disguise, not a second veto. A `work` verdict below the floor is a doubt too.

`scopeFallback` defaults to `allow`. An unavailable, illegible, or truncated classifier answer lets the turn through. The product tool mask and the Space scope still hold, so such a turn reaches MWT.ONE, SICOP, the account's mail, and the Space's files, and nothing else; what the deployment risks is one prompt's tokens. `DEFAULT_UNVERIFIED_REFUSAL` survives only for a turn with no human text, which `scopeGate` denies before any classifier call.

Both classifier calls read the previous human turn beside the current one, inside its own `<previous>` element as data, so a fragment is judged in the conversation it continues. Each call gets 512 answer tokens instead of 64, which is the room a reasoning route needs for its hidden tokens before it writes the JSON object.

## Consequences

- A record lookup answers in one provider call: no classifier latency, no classifier cost, and no dependence on a model judging a bare number.
- The guard no longer blocks business work when the classifier is slow, rate-limited, over budget, or answers in prose. The trade is that a personal request passes while the classifier is unavailable, bounded by the product tool mask.
- A personal verdict between 0.50 and 0.80 now refuses where the old floor let it through below 0.80 only as "unverified"; a personal verdict below 0.50 now passes. Both follow the same rule: the floor decides what counts as a verdict, and a doubt does not refuse.
- The confirmation call now costs latency without the power to refuse a work turn on its own; the deployment can drop it to a cheaper route through `scopeConfirmProvider` and `scopeConfirmModel`.
- Each `work` turn still costs two classifier calls. Continuation tokens after a work verdict still skip both.
- The guard's residual gap is unchanged: two answers that both call a personal request `work` remain a model error, and one wrong answer is no longer enough to refuse a business turn either.

## Alternatives considered

**Keeping the fail-closed fallback and only raising the classifier budget.** It fixes the truncated answer, and it does nothing for a low-confidence verdict on a bare case number, which is the case that was reported. The floor, not the budget, refused it.

**Adding more business vocabulary to the classifier instruction.** The vocabulary fast path was removed on purpose; a list of words is a bypass by construction, and the next record format would miss it. The deterministic rule matches a token class — a number and its prefix — not a word list of nouns.

**Lowering the floor to 0.50 and keeping the confirmation veto.** A confirmation that cannot answer would still refuse, so a healthy first answer plus one degraded second call would still block the turn. The confirmation now only refuses when it positively disagrees.

**Refusing only the tool surface and letting every prompt through.** It removes the guard's reason to exist: a personal answer costs the deployment tokens even when no tool runs. The positive `personal` verdict is the part worth keeping.

## Testing

`packages/faberloom/session-agent/tests/policy.spec.ts` covers `C-B02.12`: the accepted reference forms, the rejected personal forms, and the classifier question carrying the previous turn. `tests/session-agent.spec.ts` covers the guard: a record reference passing with no classifier call, a `personal` verdict below the floor passing, a low-confidence `work` verdict spending the key, an unavailable classifier allowing by default and refusing under `scopeFallback: 'refuse'`, an unreadable answer never called personal, a confirmation that answers `personal` refusing with the personal text, the continuation memory, and the own-key path. Package suite: 115 tests, `tsc` and `oxlint` at zero.
