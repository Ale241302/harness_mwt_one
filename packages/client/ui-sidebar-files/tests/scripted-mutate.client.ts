/** The tree's mutation calls, each answered by hand, one deferred result per call. */
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileMutation } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { FilesMutator } from '../src/client/face.ts'

/** The scripted mutations: the mocks the face receives, and the hand that settles them. */
export interface ScriptedMutations {
  readonly mutator: FilesMutator
  readonly createFile: Mock<FilesMutator['createFile']>
  readonly createDirectory: Mock<FilesMutator['createDirectory']>
  readonly move: Mock<FilesMutator['move']>
  readonly remove: Mock<FilesMutator['remove']>
  /** Settle the oldest outstanding call and let its store write land. */
  readonly settle: (result: RemoteResult<WorkspaceFileMutation>) => Promise<void>
  /** Name of each call not yet settled, oldest first. */
  readonly outstanding: () => readonly string[]
}

/** The answer one successful mutation gives when the spec does not care which. */
export const CREATED: WorkspaceFileMutation = { operation: 'created-file', path: 'p', absolutePath: '/work/app/p' }

/**
 * Build mutations whose every call stays pending until the spec settles it.
 * @returns the scripted mutations.
 */
export function scriptedMutations(): ScriptedMutations {
  const pending: Array<{ name: string; resolve(result: RemoteResult<WorkspaceFileMutation>): void }> = []
  const call = (name: string) => vi.fn((..._args: unknown[]) =>
    new Promise<RemoteResult<WorkspaceFileMutation>>((resolve) => { pending.push({ name, resolve }) }))
  const land = async (
    next: { resolve(result: RemoteResult<WorkspaceFileMutation>): void } | undefined,
    result: RemoteResult<WorkspaceFileMutation>,
  ): Promise<void> => {
    if (next === undefined) throw new Error('no outstanding mutation to settle')
    next.resolve(result)
    await Promise.resolve()
    await Promise.resolve()
  }
  const createFile = call('createFile') as unknown as Mock<FilesMutator['createFile']>
  const createDirectory = call('createDirectory') as unknown as Mock<FilesMutator['createDirectory']>
  const move = call('move') as unknown as Mock<FilesMutator['move']>
  const remove = call('remove') as unknown as Mock<FilesMutator['remove']>
  return {
    mutator: { createFile, createDirectory, move, remove },
    createFile,
    createDirectory,
    move,
    remove,
    settle: result => land(pending.shift(), result),
    outstanding: () => pending.map(entry => entry.name),
  }
}
