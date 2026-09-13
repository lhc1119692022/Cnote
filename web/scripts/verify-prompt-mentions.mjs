import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const source = readFileSync(resolve(sourceRoot, 'lib/generation/prompt-mentions.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('module', 'exports', 'require', code)(module, module.exports, (specifier) => {
  if (specifier === '@/types/flow') return {}
  return require(specifier)
})

const { filterPromptMentionReferences, getPromptMentionContext, getPromptMentionToken, removePromptMention, replacePromptMention } = module.exports
const references = [
  { id: 'image-1', type: 'image', label: '角色正面', order: 0 },
  { id: 'video-1', type: 'video', label: '镜头节奏', order: 1 },
  { id: 'image-2', type: 'image', label: '场景参考', order: 2 },
]

assert.deepEqual(getPromptMentionContext('参考 @', 4), { start: 3, end: 4, query: '' })
assert.deepEqual(getPromptMentionContext('参考 @镜头', 6), { start: 3, end: 6, query: '镜头' })
assert.equal(getPromptMentionContext('someone@example.com', 19), null)
assert.equal(getPromptMentionContext('参考 @Image1 已选', 13), null)

assert.equal(getPromptMentionToken(references[0], references), '@Image1')
assert.equal(getPromptMentionToken(references[1], references), '@Video1')
assert.equal(getPromptMentionToken(references[0], references, { 'image-1': '@角色' }), '@角色')
assert.equal(getPromptMentionToken(references[2], references, { 'image-1': '@Image1' }), '@Image2', 'new references never collide with stored tokens')
assert.deepEqual(filterPromptMentionReferences(references, '镜头'), [references[1]])
assert.deepEqual(filterPromptMentionReferences(references, 'image'), [references[0], references[2]])

const context = getPromptMentionContext('参考 @', 4)
assert.equal(replacePromptMention('参考 @ 的运动', context, '@Video1'), '参考 @Video1 的运动')
assert.equal(removePromptMention('使用 @Video1、@Video10 和 @Video1', '@Video1', '[已移除视频]'), '使用 [已移除视频]、@Video10 和 [已移除视频]')

const reordered = [references[2], references[1], references[0]]
assert.equal(getPromptMentionToken(reordered[2], reordered, { 'image-1': '@角色' }), '@角色')
assert.equal(getPromptMentionToken(reordered[0], reordered, { 'image-2': '@场景' }), '@场景')
console.log('prompt mentions: PASS')
