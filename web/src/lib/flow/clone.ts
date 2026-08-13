/**
 * Flow data is persisted as plain structured-cloneable values. Always clone at
 * snapshot/copy boundaries so nested payload, preview, source, and parse data
 * never remain shared between independent nodes, favorites, or templates.
 */
export function cloneFlowValue<T>(value: T): T {
  return structuredClone(value)
}
