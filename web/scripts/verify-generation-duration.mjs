import assert from 'node:assert/strict'
import { sourceLoader } from './helpers/load-source.mjs'

let draft
const load = sourceLoader({ react: {
  useState: initial => [draft ?? initial, value => { draft = value }],
  useEffect: () => {},
} })
const { GenerationDurationInput } = load('canvas/components/GenerationDurationInput.tsx')
function mount(props) {
  let result
  const tree = GenerationDurationInput({ ...props, onChange: value => { result = value } })
  return { input: tree.props.children[0], buttons: tree.props.children[1].props.children, result: () => result }
}
for (const [value, direction, expected] of [[5, 0, 10], [10, 0, 20], [20, 1, 10], [10, 1, 5]]) {
  draft = undefined
  const control = mount({ value, allowed: [20, 5, 10] })
  control.buttons[direction].props.onClick()
  assert.equal(control.result(), expected, 'uneven discrete durations step to the adjacent allowed value')
}
draft = undefined
const continuous = mount({ value: 5, min: 4, max: 30 })
continuous.input.props.onKeyDown({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} })
assert.equal(continuous.result(), 6)
draft = '17'
const typed = mount({ value: 5, allowed: [5, 10, 20] })
typed.input.props.onBlur()
assert.equal(typed.result(), 20)
draft = ''
const empty = mount({ value: 10, allowed: [5, 10, 20] })
empty.input.props.onBlur()
assert.equal(empty.result(), 10)
draft = undefined
assert.ok(mount({ value: 15, allowed: [15] }).buttons.every(button => button.props.disabled))
console.log('Duration controls: continuous, uneven discrete, typed values, empty input and fixed bounds passed')
