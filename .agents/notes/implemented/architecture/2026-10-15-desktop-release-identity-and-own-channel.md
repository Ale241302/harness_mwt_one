# Agent Note: The Desktop carries this product's identity and its own update origin

Status: implemented

English | [中文](2026-10-15-desktop-release-identity-and-own-channel.zh.md)

## Problem

Three facts about a release were decided by the packaging environment rather than by the product.

The application identifier was one of them. Every target required `DSH_DESKTOP_APP_ID`, so a package could not be built without an environment variable naming the product that owns the installation, and the value the operating system records for the application, its uninstaller, and its file associations lived in a launcher instead of in the source.

The production update origin was another. `production` defaulted to the upstream project's host, `https://download.deepseek.com`, so an installation of this fork looked for its updates on the vendor's server. The consequence the [packaging and updates decision](2026-08-25-electron-desktop-packaging-and-updates.md) accepts is that the release of this application is tied to its runtime: an installation that cannot reach its own channel cannot be updated at all.

The transfer step was the third. The only implemented destination was a Tencent COS bucket, so a deployment that already serves the product from its own host had to obtain an object-storage account and a credential pair before it could publish anything. Storage accounts are the part of a release that a small deployment is least likely to have and least likely to need: the channel is a few files under one path per target.

## Decision

**The product supplies its own application identifier.** `DEFAULT_DESKTOP_APP_ID` in `apps/desktop/scripts/desktop-release-environment.mjs` is `one.mwt.faberloom`, and `resolveDesktopAppId` uses it when the environment carries no value or a blank one, while still validating whatever it resolves against the reverse-DNS rule. A build states whose product it is without requiring an environment, and a deployment that distributes under another identity still overrides it.

**Production resolves this fork's own origin.** `UPDATE_ENVIRONMENTS.production.fixedOrigin` is `https://harness.mwt.one`, the host that already serves the product, so an installation that sets nothing follows this deployment's own channel. `DOWNLOAD_PROD_ORIGIN` still overrides it and is still validated as an absolute HTTPS origin without a path, credentials, query, or fragment. The `test` deployment keeps requiring its explicit `DOWNLOAD_TEST_ORIGIN`, because a rehearsal should name the host it publishes to.

**A release can be published to the host that serves the origin.** `createDesktopChannelPlan` in `apps/desktop/scripts/desktop-upload-plan.ts` validates a completed package, its completion record, its two versions, its channel metadata, artifact names, sizes, SHA-512 values, and the Windows blockmap size, and returns the served path without naming a storage account. `apps/desktop/scripts/stage-target-channel.ts` lays that plan out under `_/harness/desktop/stable/<target>/`, which is the exact path the packaged application computes from its origin. `scripts/publish-desktop-channel.ps1` stages one target, copies the tree to the host by `scp`, replaces only that target's directory, and checks the channel metadata over HTTPS. The gateway serves `/_/harness/desktop/` from the directory its own stack mounts read-only (`DESKTOP_CHANNEL_DIR` in `docker-compose.yml`), answering `no-cache` for the channel metadata and a one-year cache for the versioned artifacts, and `nginx/harness.conf` proxies that prefix to the gateway without buffering. The COS path stays: a deployment that prefers object storage keeps `upload:*`, and `createDesktopUploadPlan` now composes the channel plan with the bucket and credential variable names the transfer needs.

**Staging rebuilds the published target's directory.** The COS upload never deletes historical objects, and that is right for a bucket that also serves as an archive. A filesystem channel is different: an installer or a blockmap that a newer release replaced must stop being downloadable, or the origin accumulates every version that ever shipped. Staging therefore removes the target's directory and writes the validated plan into it, while the other targets keep their last release.

**The channel stays tied to signing.** An unsigned package embeds no update feed. That is not an accident of this change but the reason it is acceptable to point a feed at the deployment: an application that updates itself installs code from a remote origin, so `macos-signature.spec.ts` pins `publish: null` for the unsigned path and this change leaves that pin alone.

## Alternatives considered

**Requiring `DSH_DESKTOP_APP_ID` and documenting it as the deployment's job.** The identifier is not a secret and does not vary per operator: it names the product, and this fork is one product. Requiring it made every build depend on a launcher carrying a fact the source already knows.

**Keeping the upstream origin as the production default.** An installed fork would poll the upstream project's release host for its own updates, which is the coupling this work exists to remove. A default that only matters for deployments that set nothing is exactly the default that has to be this product's own.

**Running object storage on the deployment to avoid a new uploader.** It replaces one account with another component to operate, patch, back up, and secure, for a channel of three files per target that a file server already publishes. The origin that serves the product is the smallest addition that makes a release independent of a third party.

**Uploading the artifacts directory without validating it first.** `electron-updater` verifies the downloaded payload against the `sha512` and `size` in the channel metadata, so a mismatched pair does not corrupt anything, it bricks updates until someone notices. The COS path already paid for that validation; the staging path reuses it rather than writing a second, weaker check.

**Merging into the target directory instead of rebuilding it.** A merged directory keeps a superseded installer downloadable forever, and it cannot tell a replaced file from a file that should stay, which is the same defect the deployment's own push script documents when it removes retired catalogs before extracting.

**Making the unsigned build embed the feed after all.** It would let the whole chain be rehearsed today, and it would also let an unsigned application install unsigned code from a remote origin without the operating system having a say. The certificate is the missing input, so the honest move is to leave the pin and say so.

## Consequences

Packaging needs no environment for identity or for the channel origin. `pnpm run package:desktop:win:x64:unsigned` runs with none at all, which is what makes the rehearsal a rehearsal. A production package without `DOWNLOAD_PROD_ORIGIN` follows this deployment's host, so moving the channel is one variable rather than a release.

Publishing a release is `package:desktop:<target>` followed by `publish-desktop-channel.ps1 -Target <target>` when the deployment serves its own channel, or `upload:<target>` when it uses COS. Both paths validate the same completed package.

The channel shares the product's host and certificate, so an outage of the host is an outage of the update channel. Serving it costs one read-only mount and one route in the gateway, both of which the deployment push carries, plus a proxy prefix in `nginx/harness.conf`, which is a file bind-mount and is therefore applied on the host and reloaded; the deployment README states that. The gateway does not buffer the download in its own memory: it hands the path to `res.sendFile`, which streams it and answers range requests.

The channel is empty until a signed release exists, because a signed package is the only package that carries a feed. This change does not remove that dependency, and no code can: an EV certificate for Windows and a Developer ID certificate with notarization credentials for macOS are purchases, not commits. What it removes is everything else a deployment would have had to supply, which was an application identifier, an origin, and a storage account.

## Testing

`apps/desktop/tests/macos-signature.spec.ts` covers the product default, a blank value, an explicit override, and the malformed identifier that must still be rejected. `apps/desktop/tests/desktop-auto-update-environment.spec.ts` covers production resolving the fork origin with no environment at all, and `DOWNLOAD_PROD_ORIGIN` overriding it while a path in it is still refused. `apps/desktop/tests/desktop-upload-plan.spec.ts` derives its fixture's completion record from the resolver instead of repeating the origin, so the fixture cannot assert a channel the packaging no longer resolves. `apps/desktop/tests/stage-target-channel.spec.ts` is new and covers the served path without COS settings, rebuilding the target directory while another target keeps its release, and refusing a completion record that names another origin.

`tsc -b tsconfig.host.json`, the `apps/desktop` lane, oxlint, and `test:docs` pass. The unsigned rehearsal runs the documented command with no release environment and produces its installer under `.desktop-build/targets/win-x64/unsigned-artifacts/`. Because an unsigned package embeds no feed, no staged release has been served from the origin yet: the missing input for that is the certificate, and the deployment steps that follow it are `package:desktop:win:x64`, `publish-desktop-channel.ps1 -Target win-x64`, and a client install that reads `latest.yml`.
