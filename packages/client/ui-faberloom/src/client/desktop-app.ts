/**
 * Where this UI is running.
 *
 * The Desktop application's preload injects `window.dshDesktop` into the
 * application document (`{ protocolVersion: 1 }`); a browser gets no such
 * global. That is the one difference between the two hosts of these panels:
 * a folder of the operator's own machine can only be picked where the Host
 * runs on that machine.
 */

/** The Desktop marker the application preload exposes; absent in a browser. */
interface DesktopMarker {
  readonly protocolVersion?: unknown
}

/**
 * Whether the current document is hosted by the Desktop application.
 * @returns true when the Desktop preload injected its protocol marker.
 */
export function isDesktopApplication(): boolean {
  const marker = (globalThis as { dshDesktop?: DesktopMarker }).dshDesktop
  return marker?.protocolVersion === 1
}
