/**
 * Pointer gesture state machine for the canvas engine.
 * No DOM / React: the host injects viewport + hit-test results and consumes events.
 *
 * Mode transitions:
 *   idle + down(space|middle)        → panning         + pan-start
 *   idle + down(left, hitNodeId)     → dragging-nodes  + node-drag-start
 *   idle + down(left, empty)         → marquee         + marquee-start
 *   panning + move / up              → pan-move / pan-end → idle
 *   marquee + move / up              → marquee-move / marquee-end → idle
 *   dragging-nodes + move / up       → node-drag-move / node-drag-end → idle
 *   connecting 不走 pointerDown/Move/Up：由 beginConnect / updateConnect / endConnect 驱动。
 */

import type { Point, Viewport } from '@/domain'
import { screenToWorld } from './viewport'

export type CanvasMode = 'idle' | 'panning' | 'marquee' | 'dragging-nodes' | 'connecting'

export interface PointerInput {
  screen: Point
  world: Point
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  /** Optional per-event space-key override; otherwise use `setSpacePressed`. */
  spaceKey?: boolean
}

export type CanvasInteractionEvent =
  | { type: 'marquee-start'; start: Point; current: Point }
  | { type: 'marquee-move'; start: Point; current: Point }
  | { type: 'marquee-end'; start: Point; current: Point; shiftKey?: boolean }
  | { type: 'pan-start' }
  | { type: 'pan-move'; delta: Point }
  | { type: 'pan-end' }
  | { type: 'gesture-cancel' }
  | { type: 'node-drag-start'; nodeId: string }
  | { type: 'node-drag-move'; nodeId: string; deltaWorld: Point }
  | { type: 'node-drag-end'; nodeId: string; deltaWorld: Point }
  | { type: 'connect-start'; sourceId: string }
  | { type: 'connect-move'; sourceId: string; current: Point }
  | { type: 'connect-end'; sourceId: string; targetId?: string; current: Point }

export class CanvasInteraction {
  private mode: CanvasMode = 'idle'
  private spacePressed = false
  private startWorld: Point = { x: 0, y: 0 }
  private lastScreen: Point = { x: 0, y: 0 }
  private dragNodeId: string | null = null
  private connectSourceId: string | null = null
  private connectCurrent: Point = { x: 0, y: 0 }

  constructor(
    private readonly getViewport: () => Viewport,
    private readonly emit: (event: CanvasInteractionEvent) => void,
  ) {}

  getMode(): CanvasMode {
    return this.mode
  }

  setSpacePressed(pressed: boolean): void {
    this.spacePressed = pressed
  }

  /** Abort an interrupted pointer gesture without committing a drag or marquee. */
  cancel(): void {
    if (this.mode === 'idle') return
    if (this.mode === 'panning') this.emit({ type: 'pan-end' })
    this.emit({ type: 'gesture-cancel' })
    this.mode = 'idle'
    this.dragNodeId = null
    this.connectSourceId = null
  }

  /**
   * `hitNodeId` is resolved by the host (this class does not hit-test).
   * Space or middle-button always pans, even when a node is under the pointer.
   */
  pointerDown(input: PointerInput, hitNodeId?: string): void {
    if (this.mode !== 'idle') return

    const world = this.worldOf(input)
    this.startWorld = world
    this.lastScreen = { x: input.screen.x, y: input.screen.y }
    this.dragNodeId = null

    const wantsPan = this.isSpace(input) || input.button === 1
    if (wantsPan) {
      this.mode = 'panning'
      this.emit({ type: 'pan-start' })
      return
    }

    if (input.button !== 0) return

    if (hitNodeId) {
      this.mode = 'dragging-nodes'
      this.dragNodeId = hitNodeId
      this.emit({ type: 'node-drag-start', nodeId: hitNodeId })
      return
    }

    this.mode = 'marquee'
    this.emit({ type: 'marquee-start', start: world, current: world })
  }

  /**
   * connecting 由 begin/update/endConnect 驱动，pointerMove 直接返回，避免与普通手势抢事件。
   */
  pointerMove(input: PointerInput): void {
    switch (this.mode) {
      case 'idle':
      case 'connecting':
        return
      case 'panning': {
        const delta = {
          x: input.screen.x - this.lastScreen.x,
          y: input.screen.y - this.lastScreen.y,
        }
        this.lastScreen = { x: input.screen.x, y: input.screen.y }
        this.emit({ type: 'pan-move', delta })
        return
      }
      case 'marquee': {
        this.emit({
          type: 'marquee-move',
          start: this.startWorld,
          current: this.worldOf(input),
        })
        return
      }
      case 'dragging-nodes': {
        if (!this.dragNodeId) return
        this.emit({
          type: 'node-drag-move',
          nodeId: this.dragNodeId,
          deltaWorld: this.worldDelta(input),
        })
      }
    }
  }

  /**
   * connecting 的结束交给 endConnect；此处返回且不改 mode，防止误把连线掐掉。
   */
  pointerUp(input: PointerInput): void {
    switch (this.mode) {
      case 'idle':
        this.dragNodeId = null
        return
      case 'connecting':
        return
      case 'panning':
        this.emit({ type: 'pan-end' })
        break
      case 'marquee':
        this.emit({
          type: 'marquee-end',
          start: this.startWorld,
          current: this.worldOf(input),
          shiftKey: input.shiftKey,
        })
        break
      case 'dragging-nodes':
        if (this.dragNodeId) {
          this.emit({
            type: 'node-drag-end',
            nodeId: this.dragNodeId,
            deltaWorld: this.worldDelta(input),
          })
        }
        break
    }

    this.mode = 'idle'
    this.dragNodeId = null
  }

  /** idle → connecting，并发 connect-start。非 idle 则忽略。 */
  beginConnect(sourceId: string): void {
    if (this.mode !== 'idle') return
    this.mode = 'connecting'
    this.connectSourceId = sourceId
    this.connectCurrent = { x: 0, y: 0 }
    this.emit({ type: 'connect-start', sourceId })
  }

  /** 连线拖拽中：current 为世界坐标。 */
  updateConnect(current: Point): void {
    if (this.mode !== 'connecting' || !this.connectSourceId) return
    this.connectCurrent = current
    this.emit({
      type: 'connect-move',
      sourceId: this.connectSourceId,
      current,
    })
  }

  /**
   * 结束连线并发 connect-end，回到 idle。
   * targetId 由宿主 hitTest 后传入；未命中节点时传 null。
   */
  endConnect(targetId: string | null): void {
    if (this.mode !== 'connecting' || !this.connectSourceId) return
    const sourceId = this.connectSourceId
    this.emit({
      type: 'connect-end',
      sourceId,
      targetId: targetId ?? undefined,
      current: this.connectCurrent,
    })
    this.mode = 'idle'
    this.connectSourceId = null
    this.dragNodeId = null
  }

  private isSpace(input: PointerInput): boolean {
    return this.spacePressed || input.spaceKey === true
  }

  /** Live viewport wins so world deltas stay correct if zoom changes mid-gesture. */
  private worldOf(input: PointerInput): Point {
    const viewport = this.getViewport()
    if (viewport.zoom === 0) return input.world
    return screenToWorld(input.screen, viewport)
  }

  /** Cumulative world delta from pointer-down (not per-move). */
  private worldDelta(input: PointerInput): Point {
    const world = this.worldOf(input)
    return {
      x: world.x - this.startWorld.x,
      y: world.y - this.startWorld.y,
    }
  }
}
