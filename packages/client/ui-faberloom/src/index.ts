/**
 * FaberLoom surface plugin, node half. Pure UI plugin: the empty apply keeps
 * the row visible to the host Loader; the browser half ships through
 * exports["./client"], discovered through the package.json dsh.client
 * declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
