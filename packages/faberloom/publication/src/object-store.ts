/**
 * Object identity shared by every publication store: the immutable key and the
 * media type derived from the published path.
 * @module @deepseek-ai/dsh-faberloom-publication/src/object-store
 */

/** Prefix every published object lives under. */
export const PUBLICATION_PREFIX = 'publications/'

/**
 * The immutable key of one published file. The commit is the key's middle
 * segment, so a later revision can never overwrite an earlier one.
 * @param commit - commit the file was published from.
 * @param path - repository-relative path.
 * @returns `publications/<commit>/<path>`.
 */
export function publicationObjectKey(commit: string, path: string): string {
  return `${PUBLICATION_PREFIX}${commit}/${path}`
}

/**
 * The immutable key of the signed manifest for one revision.
 * @param commit - commit the publication fixed.
 * @returns `publications/<commit>/.faberloom/manifest.json`.
 */
export function publicationManifestKey(commit: string): string {
  return `${PUBLICATION_PREFIX}${commit}/.faberloom/manifest.json`
}

/**
 * The media type a published path is served as. Markdown documents keep their
 * type so a reader renders them; everything else is plain text.
 * @param path - repository-relative path.
 * @returns `text/markdown` or `text/plain`.
 */
export function contentTypeOf(path: string): string {
  return /\.(?:md|markdown)$/iu.test(path) ? 'text/markdown' : 'text/plain'
}
