import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  NCM_SAMPLE_RATE,
  WINDOW_FROM_SECONDS,
  WINDOW_LEN_SECONDS,
  decimateTo8k,
  toLittleEndianBytes,
} from '../src/core/musicRecognition/pcmSplitter.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const assetDir = path.join(here, '..', 'android', 'app', 'src', 'main', 'assets', 'recognition')
const wasmBytes = new Uint8Array(fs.readFileSync(path.join(assetDir, 'afp.wasm')))
const glueSource = fs.readFileSync(path.join(assetDir, 'afp-glue.js'), 'utf8')
const wasmDataUrl = 'data:application/octet-stream;base64,' + Buffer.from(wasmBytes).toString('base64')
// 本仓库 tsconfig 的 types 只有 react-native + node（没有 DOM lib），所以 `WebAssembly` 没有全局声明，
// 直接写简写属性会炸 TS18004。Node 运行时是提供这个全局的，从 globalThis 上取，注入的对象完全等价。
const globalWebAssembly: unknown = (globalThis as Record<string, unknown>).WebAssembly

interface GlueApi {
  Encode: (audiodata: unknown, from: number, len: number, channel: number) => Promise<string>
  Encode8kB64: (samplesB64: string) => Promise<string>
}

// 模拟 WebView 的宿主环境：有 window / WebAssembly / atob / fetch，没有 process / fs / path
const loadGlue = (): GlueApi => {
  const host: Record<string, unknown> = {
    window: {},
    WebAssembly: globalWebAssembly,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    // 胶水 NeteaseRecordArrayToBase64(afp-glue.js:2020) 用 setInterval 轮询 wasm 是否就绪，
    // 没有重试上限，只在就绪时 clearInterval。资产损坏 / wasm 实例化失败时这个 interval 会一直
    // 挂着并吊住事件循环：node --test 子进程不退出、`# fail` 汇总不输出、退出码也拿不到，
    // 闸门于是以「超时」而不是「失败」暴露。句柄 unref 后它不再阻止进程排空退出，
    // 成功路径仍靠 clearInterval 自清理，行为不变。
    setInterval: (fn: (...args: unknown[]) => unknown, ms?: number) => {
      const handle = setInterval(fn, ms)
      handle.unref()
      return handle
    },
    clearInterval,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    crypto: {
      getRandomValues: (buffer: Uint8Array) => {
        for (let i = 0; i < buffer.length; i++) buffer[i] = Math.floor(Math.random() * 256)
        return buffer
      },
    },
    btoa: (data: string) => Buffer.from(data, 'binary').toString('base64'),
    atob: (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
    __AFP_URL__: wasmDataUrl,
    fetch: async(url: unknown) => {
      if (String(url).startsWith('data:')) return { ok: true, arrayBuffer: async() => Uint8Array.from(wasmBytes).buffer }
      throw new Error('unexpected fetch target: ' + String(url))
    },
  }
  host.globalThis = host
  const context = vm.createContext(host)
  const mod: { exports: GlueApi } = { exports: {} as GlueApi }
  vm.runInContext('(function(module, exports, require){' + glueSource + '\n})', context, { filename: 'afp-glue.js' })(
    mod,
    mod.exports,
    () => { throw new Error('require is not available in the webview sandbox') },
  )
  return mod.exports
}

// 三个叠加正弦，保证有峰值可提取（纯静音会被胶水的 byteLength <= 64 判据拒掉）
const makeTone = (seconds: number): Int16Array => {
  const pcm = new Int16Array(seconds * NCM_SAMPLE_RATE)
  for (let i = 0; i < pcm.length; i++) {
    const t = i / NCM_SAMPLE_RATE
    const v = Math.sin(2 * Math.PI * 440 * t) * 0.35 +
      Math.sin(2 * Math.PI * 1320 * t) * 0.25 +
      Math.sin(2 * Math.PI * 5200 * t) * 0.15
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  }
  return pcm
}

const floatOf = (pcm: Int16Array): Float32Array => {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

test('vendored 胶水已经剥掉 node 运行时依赖', () => {
  assert.doesNotMatch(glueSource, /require\(/)
  assert.doesNotMatch(glueSource, /__dirname/)
  assert.match(glueSource, /__AFP_URL__/)
  assert.match(glueSource, /Encode8kB64/)
})

test('afp.wasm 体积没有被改动', () => {
  assert.equal(wasmBytes.length, 231_182)
})

test('RN 侧抽取 + base64 传输 + WebView 还原，与上游 Encode 产出逐字节相同的指纹', { timeout: 120_000 }, async() => {
  const api = loadGlue()
  const pcm = makeTone(WINDOW_FROM_SECONDS + WINDOW_LEN_SECONDS)

  // 参照路径：完全走上游 48k AudioBuffer 接口（本机 spike 已实测该路径能被服务端接受）
  const floats = floatOf(pcm)
  const audiodata = {
    sampleRate: NCM_SAMPLE_RATE,
    length: floats.length,
    numberOfChannels: 1,
    getChannelData: () => floats,
  }
  const expected = await api.Encode(audiodata, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS, 0)
  assert.ok(expected.length > 200, '参照指纹过短，wasm 可能没跑起来')

  // 生产路径：TS 抽到 8k -> 小端字节 -> base64 -> WebView 内还原
  const window8k = decimateTo8k(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  const actual = await api.Encode8kB64(base64Of(toLittleEndianBytes(window8k)))

  assert.equal(actual, expected)

  // 阳性对照：同一批样本改写成大端必须得到不同的指纹。
  // 大端也能对上就说明上面的相等是假绿 —— wasm 压根没读到真实样本。
  const beBuffer = new ArrayBuffer(window8k.length * 2)
  const beView = new DataView(beBuffer)
  for (let i = 0; i < window8k.length; i++) beView.setInt16(i * 2, window8k[i], false)
  const bigEndianFp = await api.Encode8kB64(base64Of(new Uint8Array(beBuffer)))
  assert.notEqual(bigEndianFp, expected)
})
