/**
 * Compile the desktop installer script the way electron-builder does.
 *
 * electron-builder compiles the generated NSIS script twice — the installer
 * pass, then the uninstaller pass with `BUILD_UNINSTALLER` — and passes `-WX`,
 * so a warning (an unreferenced variable, a language missing one of our
 * strings) fails the build. This check synthesizes both passes from the same
 * language tables electron-builder uses, expands only the macros each pass
 * expands, and compiles over every bundled language. Run it before the long
 * packaging command; `apps/desktop/scripts/smoke-windows.ps1` calls it.
 *
 * Usage: node check-installer-script.mjs <makensis> [repoRoot]
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const makensis = process.argv[2]
if (makensis === undefined) throw new Error('Pass the pinned builder\'s makensis executable')
const repoRoot = resolve(process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))
const appBuilder = dirname(require.resolve('app-builder-lib/package.json'))
const { createAddLangsMacro, LangConfigurator } = require(join(appBuilder, 'out/targets/nsis/nsisLang.js'))
const { bundledLanguages, lcid } = require(join(appBuilder, 'out/util/langs.js'))

const installerScript = join(repoRoot, 'apps/desktop/scripts/installer.nsh')
const scratch = mkdtempSync(join(tmpdir(), 'dsh-installer-script-'))
const uninstaller = join(scratch, 'uninstaller.exe')

let languageMacros = []
createAddLangsMacro({ macro: (_name, lines) => { languageMacros = lines } }, new LangConfigurator({}))
// electron-builder also emits its own localized strings for every language it
// loads; only the two this script reads matter here.
const bundledMessages = bundledLanguages.flatMap(language => [
  `LangString areYouSureToUninstall ${lcid[language]} "Confirm?"`,
  `LangString decompressionFailed ${lcid[language]} "Failed."`,
])

/** The two passes electron-builder compiles, each expanding only its own macros. */
const passes = [
  {
    name: 'installer',
    defines: [],
    body: [
      'Section "Install"',
      `  WriteUninstaller "${uninstaller}"`,
      '  StrCpy $installMode "current"',
      '  !insertmacro customInstall',
      'SectionEnd',
    ],
  },
  {
    name: 'uninstaller',
    defines: ['BUILD_UNINSTALLER'],
    body: [
      'Section "Install"',
      `  WriteUninstaller "${uninstaller}"`,
      'SectionEnd',
      'Section "un.Uninstall"',
      '  !insertmacro customUnInstall',
      'SectionEnd',
      'Function un.onInit',
      '  StrCpy $installMode "current"',
      '  !insertmacro customUnInit',
      'FunctionEnd',
    ],
  },
]

try {
  for (const pass of passes) {
    const script = [
      'Unicode true',
      'Name "Faberloom"',
      `OutFile "${join(scratch, `${pass.name}.exe`)}"`,
      // The generated script always defines these before the hook runs.
      '!define APP_FILENAME "Faberloom"',
      '!define APP_PACKAGE_NAME "dsh-desktop"',
      'Var installMode',
      ...pass.defines.map(define => `!define ${define}`),
      '!include "MUI2.nsh"',
      `!include "${installerScript}"`,
      '!insertmacro MUI_UNPAGE_WELCOME',
      '!insertmacro MUI_UNPAGE_INSTFILES',
      ...bundledMessages,
      ...languageMacros,
      ...pass.body,
      '',
    ].join('\n')
    const file = join(scratch, `${pass.name}.nsi`)
    writeFileSync(file, script)
    execFileSync(makensis, ['-INPUTCHARSET', 'UTF8', '-WX', '/V2', file], { stdio: 'inherit' })
    process.stdout.write(`installer script: ${pass.name} pass clean (${bundledLanguages.length} languages)\n`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
