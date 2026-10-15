/** The directory picker the shipped Desktop composition serves. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'

it('serves the operating system chooser instead of the in-app browser', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-picker-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir)
    const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
    const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
    const overlay = fileURLToPath(new URL('../../desktop-host/config/desktop.cordis.patch.yml', import.meta.url))
    const warnings: string[] = []
    const rows = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
      loadOverlayPatches('dsh desktop', overlay),
    ], message => warnings.push(message))

    expect(rows.find(row => row.id === 'directory-picker')).toMatchObject({
      name: '@deepseek-ai/dsh-host-directory-picker-auto',
      disabled: true,
    })
    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-host-directory-picker-native'))
      .toEqual([{ id: 'directory-picker-native', name: '@deepseek-ai/dsh-host-directory-picker-native' }])
    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-client-ui-directory-picker-native'))
      .toEqual([{ id: 'ui-directory-picker-native', name: '@deepseek-ai/dsh-client-ui-directory-picker-native' }])
    expect(rows.filter(row => row.name.includes('directory-picker-browse'))).toEqual([])
    expect(warnings).toEqual([])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
