const { serializeEntities } = require('./processor.cjs')

process.parentPort.on('message', ({ data }) => {
  const start = performance.now()
  const serialized = serializeEntities(data.entities)
  process.parentPort.postMessage({ id: data.id, serialized, computeMs: performance.now() - start })
})
