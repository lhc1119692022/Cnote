import assert from 'node:assert/strict'
import { NativeContentPort } from '../dist/runtime/content-port.js'

const parsed = await new NativeContentPort().parseHtml({
  url: 'https://example.com/article',
  html: `
    <html><head><title>Demo &amp; Cnote</title></head>
    <body><script>throw new Error('must not execute')</script>
      <h1>标题</h1><p>正文 &amp; 内容</p><a href="/next">下一页</a>
    </body></html>
  `,
})

assert.equal(parsed.title, 'Demo & Cnote')
assert.match(parsed.text, /正文 & 内容/)
assert.deepEqual(parsed.headings, [{ level: 1, text: '标题' }])
assert.deepEqual(parsed.links, [{ text: '下一页', url: 'https://example.com/next' }])
assert.equal(parsed.parserId, 'cnote-native-html')
assert.equal(parsed.parserVersion, '1.0.0')

console.log('Desktop runtime content parser tests passed.')
