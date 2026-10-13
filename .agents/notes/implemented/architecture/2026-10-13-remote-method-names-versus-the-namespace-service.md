# Agent Note: A Remote method name must not collide with its namespace service

Status: implemented

English | [中文](2026-10-13-remote-method-names-versus-the-namespace-service.zh.md)

## Problem

The browser's Remote assembly (`@deepseek-ai/dsh-api-remotes`) mounts every selected namespace by registering one client service per namespace. That service, `RemoteNamespaceService`, owns an API of its own: `has`, `remove`, `installDirect`, `installScoped`, and the rest of its prototype including the Cordis `Service` base. `packages/api/workspace-files` exposed a mutation verb named `remove`, so mounting its namespace threw `client api: method "workspaceFiles/remove" conflicts with its namespace service` from `assertMethodAvailable` inside the assembly's `apply`. The assembly mounts all namespaces in one transaction, so the throw disposed the namespaces already installed: every `remote.*` service vanished, 44 client entries stayed pending forever, and the web client rendered "Failed to load plugins" instead of the app. Nothing smaller failed, because nothing smaller is what holds the remote surface.

## Decision

**The verb is `removePath`.** It names the operation (one file, or one directory when it is empty or the call asks for its contents), keeps the mutation family (`createFile`, `createDirectory`, `move`), and avoids the service's own API. `packages/faberloom/tool-faberloom`'s `faberloom_files_delete` calls the renamed verb; no client code did, so the browser half is unchanged.

**A reserved name is part of the Remote contract, and only the browser enforces it.** `RemoteNamespaceService.assertMethodAvailable` rejects a method whose name is in `REMOTE_NAMESPACE_FIELDS` or appears on the service's prototype. The check runs where the namespace is mounted, which is the client assembly, not the Host that declares `@Remote`. A Host-side test, a typecheck, and the package's own suite therefore cannot observe the collision: they exercise the service, and only a real client assembly ever constructs the namespace service.

## Consequences

- The blast radius is the whole remote surface. One namespace's method name is enough to make the product unusable, while every Host-side check stays green: the failure lives in the artifact plane the browser loads, so a source-level suite cannot see it and the deployment that ships it looks healthy from `/healthz`.
- The shape of the mistake is a *name*, chosen at the Service Definition, and enforced far away in the client. The next verb, namespace, or method added anywhere in the tree inherits the same trap until a gate checks the names against the service's API.

## Alternatives considered

- **Renaming the service's `remove`.** It is the client's namespace service, shared by every namespace, and its `remove(kind, method, token)` unmounts a method; the product's verb moves instead of the framework's API.
- **Letting a contribution shadow a service method.** The rejection exists because shadowing the remover would break unmounting, and it is checked before installation rather than after.
- **Keeping `remove` and mounting the namespace under another name.** The namespace name is the Service Definition's own; the collision is in the method name, so it would have moved the problem to the next reserved word.
