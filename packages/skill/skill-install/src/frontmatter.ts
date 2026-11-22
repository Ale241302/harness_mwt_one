/**
 * Skill-frontmatter reader for the installer.
 *
 * The installer validates the two scalar keys a skill declares (`name` and
 * `description`) before copying it into a skills root. The harness provider
 * parses the full document; this module reads only what the installer checks,
 * so a skill with unsupported YAML still fails as `missing-name` instead of
 * silently installing under the wrong identity.
 *
 * @module
 */

/** Frontmatter fields and Markdown body of one skill file. */
export interface SkillFrontmatter {
  readonly data: Record<string, unknown>
  readonly body: string
}

/**
 * Read the leading YAML frontmatter of a Markdown skill file.
 * @param raw - the complete file text.
 * @returns the parsed top-level scalars and the body, or undefined without frontmatter.
 */
export function parseSkillFrontmatter(raw: string): SkillFrontmatter | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  return { data: parseScalars(raw.slice(start, closing.start)), body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** Top-level scalar keys, including `|` and `>` block scalars. */
function parseScalars(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const lines = yaml.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.replace(/\r$/, '') ?? ''
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    if (/^\s/u.test(line)) continue
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const rawValue = line.slice(separator + 1).trim()
    if (rawValue === '|' || rawValue === '>') {
      const block: string[] = []
      let cursor = index + 1
      for (; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor]?.replace(/\r$/, '') ?? ''
        if (candidate.trim().length > 0 && !/^\s/u.test(candidate)) break
        block.push(candidate)
      }
      const text = block.join('\n').replace(/^\n+|\n+$/gu, '')
      data[key] = rawValue === '|' ? text : text.replace(/\n/gu, ' ')
      index = cursor - 1
      continue
    }
    data[key] = scalar(rawValue)
  }
  return data
}

function scalar(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) return raw.slice(1, -1).replace(/''/gu, "'")
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw.replace(/\s+#.*$/u, '')
}
