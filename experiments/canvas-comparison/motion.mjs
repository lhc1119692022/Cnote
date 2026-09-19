import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const framesPerSecond = 240
const durationSeconds = 2
const cubic = fraction => 1 - (1 - fraction) ** 3
const targetZoom = Math.min(1.2, Math.max(.5 * 1.12, Math.min(1440 * .8 / 540, 900 * .8 / 430)))
const results = []

function simulate(variant, distance, retarget, interrupt) {
  let position = { center: 0, zoom: .5 }
  let origin = { ...position }
  let target = { center: distance, zoom: targetZoom }
  let velocity = { center: 0, zoom: 0 }
  let startedAt = 0
  let running = true
  let followOrigin = null
  let interruptedPosition = null
  let maxCenter = 0
  let velocityJumpAtRetarget = 0
  const samples = []
  for (let frame = 0; frame <= framesPerSecond * durationSeconds; frame++) {
    const time = frame / framesPerSecond
    if (retarget && frame === 36) {
      origin = { ...position }
      target = { center: distance * .5, zoom: 1 }
      startedAt = time
      followOrigin = null
      if (variant.startsWith('spring')) velocityJumpAtRetarget = 0
      else if (variant !== 'instant') velocityJumpAtRetarget = Math.abs(3 * (target.center - origin.center) / (variant === 'center-then-zoom' ? .4 : .22) - velocity.center)
    }
    if (interrupt && frame === 48) {
      running = false
      position.center += 17
      interruptedPosition = { ...position }
      velocity = { center: 0, zoom: 0 }
      followOrigin = null
    }
    const previous = { ...position }
    if (running) {
      const elapsed = time - startedAt
      if (variant === 'instant') position = { ...target }
      else if (variant.startsWith('spring')) {
        const damping = variant === 'spring-critical' ? 2 * Math.sqrt(250) : 25
        for (const axis of ['center', 'zoom']) {
          velocity[axis] += (250 * (target[axis] - position[axis]) - damping * velocity[axis]) / framesPerSecond
          position[axis] += velocity[axis] / framesPerSecond
        }
      } else if (variant === 'ease220') {
        const progress = cubic(Math.min(1, elapsed / .22))
        for (const axis of ['center', 'zoom']) position[axis] = origin[axis] + (target[axis] - origin[axis]) * progress
      } else {
        position.center = origin.center + (target.center - origin.center) * cubic(Math.min(1, elapsed / .4))
        if (elapsed >= .4) {
          followOrigin ??= position.zoom
          position.zoom = followOrigin + (target.zoom - followOrigin) * cubic(Math.min(1, (elapsed - .4) / .68))
        }
      }
      if (!variant.startsWith('spring')) for (const axis of ['center', 'zoom']) velocity[axis] = (position[axis] - previous[axis]) * framesPerSecond
    }
    maxCenter = Math.max(maxCenter, position.center)
    assert.ok(Number.isFinite(position.center) && Number.isFinite(position.zoom))
    if (interruptedPosition) assert.deepEqual(position, interruptedPosition, 'manual interruption must cancel the delayed follow-through as well')
    samples.push({ time, center: position.center, zoom: position.zoom, centerError: Math.abs(position.center - target.center), zoomError: Math.abs(position.zoom - target.zoom), centerSpeed: Math.abs(velocity.center), zoomSpeed: Math.abs(velocity.zoom) })
  }
  const settled = samples.findIndex((sample, index) => sample.time >= (retarget ? .15 : 0) && samples.slice(index).every(item => item.centerError < 1 && item.zoomError < .001 && item.centerSpeed < 5 && item.zoomSpeed < .01))
  return { variant, distance, retarget, interrupt, settledMs: settled < 0 ? null : (samples[settled].time - (retarget ? .15 : 0)) * 1000, overshootPx: retarget ? null : Math.max(0, maxCenter - distance), velocityJumpAtRetarget, cancelPassed: !interrupt || interruptedPosition !== null, final: position }
}

for (const distance of [100, 2000]) for (const retarget of [false, true]) for (const interrupt of [false, true]) for (const variant of ['instant', 'ease220', 'spring-critical', 'spring-250-25', 'center-then-zoom']) results.push(simulate(variant, distance, retarget, interrupt))
const output = { scope: 'Deterministic camera-pattern comparison, not runtime rendering or a reconstruction of the original animation library', assumptions: { framesPerSecond, durationSeconds, targetZoom, springMass: 1, centerDurationMs: 400, followDelayMs: 400, followDurationMs: 680, retargetAtMs: 150, manualInterruptAtMs: 200, easing: 'cubic-out chosen for fixed-duration stages because the source excerpt does not specify easing' }, results, correct: true }
await writeFile(new URL('./results/motion.json', import.meta.url), JSON.stringify(output, null, 2))
console.log(`Motion: ${results.length} deterministic scenarios passed; no post-cancel follow-through`)
