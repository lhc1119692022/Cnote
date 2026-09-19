import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url))
const require = createRequire(import.meta.url)

export function sourceLoader(mocks = {}) {
  const modules = new Map()
  function load(relative) {
    const base = resolve(sourceRoot, relative)
    const path = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(candidate => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate))
    if (!path) throw new Error(`Missing test module: ${relative}`)
    if (modules.has(path)) return modules.get(path).exports
    const module = { exports: {} }
    modules.set(path, module)
    const source = readFileSync(path, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false, MODE: "test" })').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(path).href))
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText
    new Function('module', 'exports', 'require', compiled)(module, module.exports, specifier => {
      if (specifier.endsWith('.css')) return {}
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
      if (specifier.startsWith('@/')) return load(specifier.slice(2))
      if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier))
      return require(specifier)
    })
    return module.exports
  }
  return load
}
