import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Faberloom',
    short_name: 'Faberloom',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/faberloom_appicon512.svg',
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'maskable',
    }, {
      src: '/faberloom_favicon32.svg',
      sizes: '32x32',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships a favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light stroke must live inside the dark-scheme media query, so the woven
  // knot stays black in light mode and only turns white under a dark scheme.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*g\s*{[^}]*stroke:\s*#fff/i)
  expect(favicon).toContain('stroke="#000"')
})
