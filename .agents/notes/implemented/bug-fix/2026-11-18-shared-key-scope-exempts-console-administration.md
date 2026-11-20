# Agent Note: The shared-key scope exempts the console administration and Marluvas

Status: implemented

English | [中文](2026-11-18-shared-key-scope-exempts-console-administration.zh.md)

## Problem

An Admin (CEO) of the console asked the web app to review a product-design procedure she had attached. The session answered with the shared-key refusal — "La llave compartida solo ejecuta herramientas de MWT.ONE, SICOP y correo. Configurá tu propia llave para otras tareas." — and the same transcript shows the family: a `read` call that returned `unknown tool "read"` and a delegation call the guard denied with the same text. The account is `mqbonanza118@gmail.com`, role `admin` in the console.

Two shipped decisions combined to produce that. [The operator-scope fix](2026-11-13-mwt-guard-operator-scope.md) made `gateway/faberloom-role.mjs` downgrade every `admin`, `superadmin`, or `ceo` outside `muitowork.com` to `client_b2b`, so a tenant's administrator cannot read another company's queue. The session agent computes its shared-key restriction from the role it receives (`restricted` in `packages/faberloom/session-agent/src/index.ts`), and `client_b2b` is the restricted role. One role field therefore carried two unrelated limits: which queue the account reads, and what the deployment's key will answer.

The Desktop never applied the downgrade — `apps/desktop/src/identity.ts` writes the console role unchanged — so the same account ran unrestricted there. The product behaved differently on its two surfaces for one identity.

## Decision

**The scope of the shared key is a separate decision from the data role.** `gateway/faberloom-role.mjs` exports `faberloomKeyUnrestricted(user)`, true for the console administration roles (`admin`, `superadmin`, `ceo`) and for `marluvas`; every other role, a missing role, or a missing identity keeps the product scope. `gateway/server.mjs` renders `productOnly` in the `faberloom-session-agent` row from that function, so the web patch answers `productOnly: false` for those roles.

**The data role stays degraded.** `faberloomRole` is unchanged: an Admin/CEO with an external email still reaches the product as `client_b2b`, keeps that role's views and skill catalogue, and cannot read another company's queue. The exemption lifts the guard, the product tool mask, and the usage-policy section — nothing else.

**A session outside the scope must say so.** The shared skill `skills-shared/politica-llave-compartida` sits in every role's catalogue and states the product scope as a fact. An exempt session that loaded it refused a personal request on its own even with the guard and the mask already gone: the reported transcript shows the model loading the skill and answering "la llave compartida de la cuenta está limitada al trabajo de MWT.ONE, SICOP y el correo". `packages/faberloom/session-agent/src/index.ts` now registers `faberloom:usage-policy` and `faberloom:key-scope-exemption` as mutually exclusive texts, decided by the same `restricted`/own-key state: the policy renders under the product scope, the exemption renders otherwise, and the exemption names the skill so the model does not load it to refuse. The skill's description and body carry the same condition.

## Alternatives considered

**Give the account its own provider key.** Rejected as the answer to this report: the person is staff, the deployment pays for her work, and asking her to configure a key turns a product defect into her configuration task. It remains the path the refusal text offers to accounts that stay restricted.

**Revert the downgrade for `admin` and `ceo`.** Rejected: it reopens the queue leak the operator-scope fix closed, because the same role names drive the installation-wide board read (`packages/faberloom/view/src/index.ts`).

**Exempt only the operator domains, and add the account's email to an allowlist.** Rejected for now: the deployment asked for the two roles, an email list grows one report at a time, and it would leave the next Admin with an external address refused again. It is the tightening move if an external tenant's administrator ever gets the key exemption without being intended to.

## Consequences

An Admin (CEO) or a Marluvas account now answers design, code, and personal requests on the shared key, on the web and on the Desktop alike, and the bill for that use is the deployment's. The exemption is stated in the session prompt, so the shared skill no longer overrides it. A `client_b2b`, `manager`, `viewer`, or `agente_mcp` account keeps the product scope, the mask, and the classifier.

Two gaps stay open. The Desktop still passes the console role unchanged, so an external Admin/CEO reaches the Desktop with the installation-wide role, and this change does not close that — it only stops the web from over-restricting the key of an account the Desktop already treated as staff. And a genuinely restricted session still cannot read its own attachment: in the reported transcript the `read` call returned `unknown tool "read"`, and the delegation that would have read the file was denied by the mask.

## Testing

`gateway/tests/faberloom-role.spec.mjs` pins the two decisions apart: for `mqbonanza118@gmail.com` with role `admin`, `faberloomRole` is `client_b2b` and `faberloomKeyUnrestricted` is true; `marluvas` and `ceo` are exempt regardless of domain; `client_b2b`, `manager`, and a missing identity keep the scope; and an operator-domain admin keeps the console role as before. The patch line itself has no boot-level test: `gateway/server.mjs` starts a server on import, so the rendered `productOnly` value is covered only by the unit above.

`packages/faberloom/session-agent/tests/session-agent.spec.ts` pins the prompt pair: a `client_b2b` session renders the product policy and an empty exemption, while a `marluvas` session with `productOnly: false` renders an empty policy and the exemption that names the skill.
