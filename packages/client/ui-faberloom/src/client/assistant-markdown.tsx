/**
 * The mail assistant answers in Markdown. This renders the subset a mail
 * answer uses — headings, bold, italics, inline code, bullet and numbered
 * lists — without importing the host's Markdown package, which this panel
 * deliberately does not depend on.
 */
import type { ReactNode } from 'react'
import css from './faberloom.module.css'

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*)/gu

/** Split one line into text, strong, emphasis, and code runs. */
function inline(text: string): ReactNode[] {
  const runs: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    if (match.index > last) runs.push(text.slice(last, match.index))
    if (token.startsWith('**') || token.startsWith('__')) {
      runs.push(<strong key={match.index}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      runs.push(<code className={css.emailAssistantCode} key={match.index}>{token.slice(1, -1)}</code>)
    } else {
      runs.push(<em key={match.index}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
  }
  if (last < text.length) runs.push(text.slice(last))
  return runs
}

/**
 * Render one assistant answer as blocks.
 * @param props.text - the answer Markdown.
 * @returns the rendered block list.
 */
export function AssistantMarkdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) { index += 1; continue }

    const bullet = /^\s*[-*•]\s+(.*)$/u.exec(line)
    if (bullet !== null) {
      const items: string[] = []
      while (index < lines.length) {
        const item = /^\s*[-*•]\s+(.*)$/u.exec(lines[index] ?? '')
        if (item === null) break
        items.push(item[1] ?? '')
        index += 1
      }
      blocks.push(
        <ul className={css.emailAssistantList} key={blocks.length}>
          {items.map((item, at) => <li key={at}>{inline(item)}</li>)}
        </ul>,
      )
      continue
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/u.exec(line)
    if (ordered !== null) {
      const items: string[] = []
      while (index < lines.length) {
        const item = /^\s*\d+[.)]\s+(.*)$/u.exec(lines[index] ?? '')
        if (item === null) break
        items.push(item[1] ?? '')
        index += 1
      }
      blocks.push(
        <ol className={css.emailAssistantList} key={blocks.length}>
          {items.map((item, at) => <li key={at}>{inline(item)}</li>)}
        </ol>,
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      blocks.push(<p className={css.emailAssistantHeading} key={blocks.length}>{inline(heading[2] ?? '')}</p>)
      index += 1
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim().length === 0 || /^(#{1,4})\s+/u.test(next) || /^\s*[-*•]\s+/u.test(next) || /^\s*\d+[.)]\s+/u.test(next)) break
      paragraph.push(next)
      index += 1
    }
    blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>)
  }
  return <>{blocks}</>
}
