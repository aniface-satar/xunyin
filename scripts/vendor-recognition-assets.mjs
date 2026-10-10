// 把网易识曲所需的 wasm 与胶水固化进 android assets。
// 上游包 ncm-audio-recognize 是 ISC 许可（可自由修改分发），但它是 node CJS 包，
// 在 React Native 的 WebView 里跑不起来，所以这里只做三处机械补丁（锚点不命中就当场炸）：
//   1. 去掉顶层 require('fs' / 'path' / 'crypto')
//   2. wasm 路径从 path.join(__dirname) 改成读全局 __AFP_URL__
//   3. 追加 Encode8kB64 导出，直接吃 8kHz Int16 LE 的 base64
// 产物是提交进仓库的静态文件。重新生成请跑 `node scripts/vendor-recognition-assets.mjs`。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PKG_SPEC = 'ncm-audio-recognize@1.4.0'
const EXPECTED_WASM_BYTES = 231_182
const TMP_DIR = '.tmp-vendor-afp'
const OUT_DIR = path.join('android', 'app', 'src', 'main', 'assets', 'recognition')

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform == 'win32' })

fs.rmSync(TMP_DIR, { recursive: true, force: true })
fs.mkdirSync(TMP_DIR, { recursive: true })
run('npm', ['pack', PKG_SPEC, '--pack-destination', TMP_DIR])
const tgz = fs.readdirSync(TMP_DIR).find(f => f.endsWith('.tgz'))
if (!tgz) throw new Error('npm pack 没有产出 tgz')
run('tar', ['-xzf', path.join(TMP_DIR, tgz), '-C', TMP_DIR])

const srcDir = path.join(TMP_DIR, 'package', 'src')
const wasm = fs.readFileSync(path.join(srcDir, 'afp.wasm'))
if (wasm.length != EXPECTED_WASM_BYTES) {
  throw new Error(`afp.wasm 体积变了：${wasm.length} != ${EXPECTED_WASM_BYTES}，先确认上游改了什么再放行`)
}

let glue = fs.readFileSync(path.join(srcDir, 'sandbox.bundle.cjs'), 'utf8')
const patch = (anchor, replacement) => {
  if (!glue.includes(anchor)) throw new Error(`补丁锚点没命中，说明上游源码变了：${anchor.slice(0, 48)}`)
  glue = glue.replace(anchor, replacement)
}

patch("const fs = require('fs')\n", '')
patch("const path = require('path')\n", '')
patch("const crypto = require('crypto')\n", '')

patch(
  'tt(Q = "/afp.wasm") || (Q = function (t) {\n' +
  '                return path.join(__dirname, "afp.wasm")\n' +
  '            }(Q));',
  'Q = __AFP_URL__;',
)

patch(
  'module.exports = {\n' +
  '    Encode: (audiodata, from, len, channel = 0) => {\n' +
  '        return NeteaseRecordArrayToBase64(toNCMBuffer(audiodata, from, len, channel))\n' +
  '    }\n' +
  '};',
  'module.exports = {\n' +
  '    Encode: (audiodata, from, len, channel = 0) => {\n' +
  '        return NeteaseRecordArrayToBase64(toNCMBuffer(audiodata, from, len, channel))\n' +
  '    },\n' +
  '    Encode8kB64: (samplesB64) => {\n' +
  '        const bin = atob(samplesB64)\n' +
  '        const bytes = new Uint8Array(bin.length)\n' +
  '        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)\n' +
  '        const i16 = new Int16Array(bytes.buffer)\n' +
  '        const json = {}\n' +
  '        for (let i = 0; i < i16.length; i++) json[i] = i16[i] / 32768\n' +
  '        return NeteaseRecordArrayToBase64(json)\n' +
  '    }\n' +
  '};',
)

const header = [
  '/*',
  ' * 听歌识曲 wasm 胶水，由 scripts/vendor-recognition-assets.mjs 生成，请勿手改。',
  ' * 来源：npm 包 ' + PKG_SPEC + ' 的 src/sandbox.bundle.cjs（ISC 许可）。',
  ' * 相对上游只有三处补丁：剥掉 node 的 fs/path/crypto；wasm 改从全局 __AFP_URL__ 取；',
  ' * 追加 Encode8kB64 直接吃 8kHz Int16 LE 的 base64。',
  ' * 同目录的 afp.wasm 是网易专有二进制，不随本文件的许可授权。',
  ' */',
  '',
].join('\n')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'afp.wasm'), wasm)
fs.writeFileSync(path.join(OUT_DIR, 'afp-glue.js'), header + glue)
fs.rmSync(TMP_DIR, { recursive: true, force: true })
console.log('wrote ' + path.join(OUT_DIR, 'afp.wasm') + ' (' + wasm.length + ' bytes) and afp-glue.js (' + (header + glue).length + ' bytes)')
