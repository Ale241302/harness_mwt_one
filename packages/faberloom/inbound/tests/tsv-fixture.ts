/**
 * Tesseract TSV fixtures for the OCR specs.
 *
 * The reader takes word-level TSV rather than plain text because the same pass
 * carries the confidence that decides whether a page needs the second engine.
 * Building fixtures by hand would bury every spec in eleven columns, so the
 * text is written as it reads and the rows are generated around it.
 */

/** Column header Tesseract writes first. */
const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'

/**
 * Turn readable text into the TSV Tesseract writes for it.
 * @param text - one line per text line; a blank line starts a new paragraph.
 * @param confidence - confidence reported for every word, in percent.
 * @returns the TSV document, header included.
 */
export function tesseractTsv(text: string, confidence = 90): string {
  const rows = [HEADER]
  let paragraph = 1
  let line = 1
  for (const raw of text.split('\n')) {
    if (raw.trim().length === 0) {
      paragraph += 1
      line = 1
      continue
    }
    const words = raw.trim().split(/\s+/)
    for (let index = 0; index < words.length; index += 1) {
      rows.push([
        '5', '1', '1', String(paragraph), String(line), String(index + 1),
        '0', '0', '10', '10', String(confidence), words[index],
      ].join('\t'))
    }
    line += 1
  }
  // Tesseract ends its TSV with a trailing newline.
  return `${rows.join('\n')}\n`
}
