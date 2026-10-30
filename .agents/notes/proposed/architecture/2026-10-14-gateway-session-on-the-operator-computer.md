# Agent Note: Bridge a gateway session to the operator's own computer

Status: proposed

English | [中文](2026-10-14-gateway-session-on-the-operator-computer.zh.md)

## Problem

The Desktop launches one backend, and the two choices cover different halves of what an operator wants. A gateway session shows the shared surface (Spaces, shares, the console, the product MCP servers) and its Workspaces are folders of the deployment, so the operator's own disk is out of reach. A local session reaches the operator's folders and keeps the shared data to what travels through `faberloom-shares`, so the two installations show different Spaces and different sessions. An operator who works on their own files and wants the shared surface cannot have both, and the product says so in its own screens.

The harness already separates execution from presentation in the place this needs: the client talks to a Host over the Typert remote protocol, and the Host reads, writes, and runs processes through replaceable providers. `ctx.fs` is a seam with several implementations ([filesystem packages](../../implemented/architecture/2026-09-05-workspace-files-service.md)), the execution world is portable across consumers ([portable execution world](../../implemented/architecture/2026-07-28-portable-execution-world-consumers.md)), and the SSH family already speaks a real remote world ([POSIX SSH runtime](../../implemented/architecture/2026-09-11-posix-ssh-runtime.md)): `@deepseek-ai/dsh-fs-ssh`, `@deepseek-ai/dsh-subprocess-ssh`, `@deepseek-ai/dsh-sandbox-ssh`, and `@deepseek-ai/dsh-terminal-ssh`. Nothing in the product composes them for the operator's own machine, and nothing enrolls that machine.

## Proposal

**A gateway session reaches one directory of the operator's computer through an outbound tunnel, as an execution world the deployment mounts.** The browser window stays a client of `harness.mwt.one`, so a front or backend change still ships by deploying the server, and the operator's own folder becomes usable inside the shared product.

Four things have to exist, in this order.

1. **Transport.** The operator's computer dials out and the deployment never dials in, so the operator needs no public address, no port forward on their router, and no inbound rule on the deployment. An OpenSSH reverse remote forward (`ssh -R`) to the deployment is the smallest version, because the repository already drives OpenSSH for multiplexed sessions and terminals; a WireGuard hub or a small mutual-TLS tunnel are the alternatives if `ssh -R` proves too narrow.
2. **Provider.** The gateway's per-user composition mounts `dsh-fs-ssh` (with subprocess, sandbox, and terminal rows as the world requires) against that tunnel endpoint. Key material and host verification arrive per user through the credential seam and the environment, never in the generated patch, which is the rule the product MCP rows already follow.
3. **Root.** A Workspace the operator registers must be a path in the remote world. `workspace.create` canonicalizes a path, requires an existing directory, and stores it; the registry either resolves through the mounted provider or the deployment presents the remote world at a stable path so the existing registry keeps working.
4. **Picker and policy.** The session's directory flow must list the operator's machine rather than the container (the native chooser running on the operator's computer and reporting the picked path, or a browse backend listing through the same tunnel), and the deployment needs the policy the operator can act on: which roots the agent may read, whether the process world is confined, and how the operator revokes the connection.

The two surfaces of the product then differ in one sentence: the same session, with a folder on the operator's computer instead of a folder in the deployment.

## Security

The deployment gains a path onto computers that are not its own, and that is the whole risk of this change, so it is stated before the benefit:

- **Keys are per operator and revocable in the console.** The tunnel's key is the operator's, the deployment stores a public half, and revocation is a console action that stops the world. No shared secret authorizes a machine.
- **The world is bounded by the policy, not by the tunnel.** `dsh-sandbox-ssh` and the confinement rows own what a process may reach on the remote side ([POSIX SSH runtime](../../implemented/architecture/2026-09-11-posix-ssh-runtime.md)); the roots the operator grants are the roots the picker lists and the file tools accept.
- **The operator can see the connection and stop it locally.** Closing the tunnel on the operator's computer ends the world at the next request, without touching the deployment.
- **The data belongs to the operator.** A remote Workspace is a path, not a copy: the deployment's storage keeps session logs and derived indexes, and the file bytes stay on the operator's computer.

## Alternatives considered

**Keeping the two brains and asking the operator to copy files.** It is what the product does today and it is why this note exists: a Workspace on one backend does not appear on the other, and the copies drift.

**Serving the deployed front from a local Host, so local mode follows the web.** The front, the Host API, and the plugin graph are one qualified combination, so a front of another revision would meet a Host it was not built against. The [packaging note](../../implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md) records that release identity, and the Desktop README states the consequence.

**A file-sync tool between the operator's folder and a deployment folder (Syncthing, Dropbox, a bidirectional rsync).** It moves bytes instead of moving the world, so a conflict resolution is required for every concurrent edit, the deployment's copy grows without bound, and neither side can run a process in the other's directory.

**Reverse SSH from the deployment to the operator's computer.** It needs an address the deployment can reach, gets NAT and firewall configuration per installation, and requires the operator to expose a listening port, which is strictly worse than dialing out.

**Moving the whole Host to the operator's computer and making the shared surface a client of it.** It inverts ownership of the shared data, so Spaces, shares, the console, and the product MCP servers would have to be reachable from a Host the operator owns, and it asks the deployment to serve a client whose backend it no longer controls.

**A new remote-files protocol instead of the SSH family.** `dsh-fs-ssh` already carries reads, writes, listings, processes, terminals, and a sandbox over one transport, with its behavior and failures documented; a second protocol would re-derive all of it and split the coverage.

## Acceptance criteria

One deployed `dsh` in the gateway reads, writes, and lists one directory on a test computer through the tunnel, and runs one command there, without any inbound port on that computer. A Workspace registered at that path backs a session whose `@` browser, file tools, and terminal resolve on the operator's computer. The operator's console shows the connection and can revoke it, and revocation stops the world within one request.

The spike does not include: memory and knowledge indexing of the remote world, more than one enrolled computer per operator, the in-product enrollment screen, or moving an existing local session onto the bridge.

## Risks

- **Support cost.** A world behind a tunnel fails in ways a local folder does not: a dropped tunnel, a sleeping laptop, a rotated key, a different shell. Each needs a diagnostic the operator can act on, which is product work measured in weeks, not a flag.
- **Security.** The deployment can run processes on the operator's computer within the granted policy. The design answers this with per-operator keys, revocation, an explicit root list, and remote-side confinement, and the change must not ship without them.
- **Two worlds, one session.** A session whose World is remote has to state that clearly wherever a path appears, or an operator will believe they are editing a deployment file.
- **Order.** This is the largest item in the Desktop program and the least reversible. It must not start before the local harness is complete, because the local mode is what makes the operator's files usable today and the bridge is what makes them usable with the shared surface.
