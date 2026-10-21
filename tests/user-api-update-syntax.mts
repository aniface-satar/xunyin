import test from 'node:test'
import assert from 'node:assert/strict'
import { checkScriptSyntax } from '../src/core/userApiUpdate/syntaxCheck.ts'
import { applyUpdateScript, type ScriptStore } from '../src/core/userApiUpdate/applyUpdate.ts'

const header = (name: string, version: string) => `/**\n * @name ${name}\n * @version ${version}\n */\n`
const NAME = '落雪云更新音源(实测)'

const goodScript = (version: string) => header(NAME, version) +
  "'use strict';\n(function(){ globalThis.lx.send('inited', { status: true }) })();\n"

// 上游 ql-lx-source 的真实坏法：成员源码被当成 String.replace 的替换串用，里面恰好有 $'
// （在替换串里表示「匹配位置之后的全部内容」），拼出来的文件在一行中间被啃掉一截，
// 字符串字面量没有闭合 —— 头部注释还在，所以只查头部的闸门会放它过去。
const truncatedScript = header(NAME, '2026.10.19') +
  "const K=['action(', 'search', '(((.+)+)+)+\n"

const makeStore = (stored: string): ScriptStore & { writes: string[], backups: string[] } => {
  const state = { script: stored, backup: null as string | null }
  const writes: string[] = []
  const backups: string[] = []
  return {
    writes,
    backups,
    readScript: async() => state.script,
    writeScript: async(_id, script) => {
      writes.push(script)
      state.script = script
    },
    writeBackup: async(_id, script) => {
      backups.push(script)
      state.backup = script
    },
    readBackup: async() => state.backup,
  }
}

test('语法不完整的脚本判为不可用', () => {
  const result = checkScriptSyntax(truncatedScript)
  assert.equal(result.ok, false)
})

test('能编译的脚本照常放行', () => {
  assert.equal(checkScriptSyntax(goodScript('2026.10.18')).ok, true)
})

test('闸门只看语法，运行期才炸的脚本不该被拦', () => {
  assert.equal(checkScriptSyntax(header(NAME, 'v1') + 'thisFunctionDoesNotExist(1)\n').ok, true)
})

test('空脚本不算语法错误（有没有别的手段去判）', () => {
  assert.equal(checkScriptSyntax('').ok, true)
})

// 真机是 Hermes：它的 eval 编译路径不认 async 函数，new Function 会抛
// "async functions are unsupported"。校验器不能把宿主引擎的限制当成脚本的语法错误。
test('宿主引擎的 new Function 不支持 async 时，合法脚本也不能被判坏', () => {
  const script = header(NAME, 'v1') + 'const fetchUrl = async (url) => url\n'
  const realFunction = globalThis.Function
  const hermesFunction = function() {
    throw new SyntaxError('async functions are unsupported')
  } as unknown as FunctionConstructor
  Object.defineProperty(globalThis, 'Function', { value: hermesFunction, configurable: true, writable: true })
  try {
    assert.equal(checkScriptSyntax(script).ok, true)
  } finally {
    Object.defineProperty(globalThis, 'Function', { value: realFunction, configurable: true, writable: true })
  }
})

test('自动更新取到语法不完整的脚本时拒绝写入，现有脚本与备份都不许动', async() => {
  const store = makeStore(goodScript('2026.10.18'))
  const result = await applyUpdateScript(store, { id: 'user_api_1', name: NAME, script: truncatedScript })
  assert.equal(result.status, 'syntax_error')
  assert.equal(store.writes.length, 0, '坏脚本绝不能盖掉正在用的脚本')
  assert.equal(store.backups.length, 0)
})

test('上游修好后同一个地址能正常更新', async() => {
  const store = makeStore(goodScript('2026.10.18'))
  const result = await applyUpdateScript(store, { id: 'user_api_1', name: NAME, script: goodScript('2026.10.20') })
  assert.equal(result.status, 'updated')
  assert.deepEqual(store.writes, [goodScript('2026.10.20')])
})
