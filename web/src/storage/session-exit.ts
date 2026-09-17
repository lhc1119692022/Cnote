/**
 * Close / hide / quit path: park in-flight generation, then flush graph and
 * runtime entities. Desktop waits for this before destroying the window.
 */

import { parkInflightGenerationRuns } from '@/canvas/contents/request-generation'
import { flushOpenGraphIfAny } from './graph-session'
import { flushRuntimePersistence } from './runtime-persistence'

export async function persistSessionForExit(): Promise<void> {
  parkInflightGenerationRuns()
  await flushOpenGraphIfAny()
  await flushRuntimePersistence()
}
