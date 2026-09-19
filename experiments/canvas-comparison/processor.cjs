function serializeEntities(entities) {
  return entities.map(entity => JSON.stringify(entity))
}

module.exports = { serializeEntities }
