import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signatureFromPcm16k } from '../src/core/musicRecognition/shazamSignature.ts'

// 期望值由 shazamio 0.8.1 的 Python 编码器在同样的 PCM 上生成（纯整数公式，两边逐点等价）。
// 对拍一旦不等，说明签名内容变了——服务端只会安静地认不出歌，不会报错。
const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = JSON.parse(
  fs.readFileSync(path.join(here, 'fixtures', 'music-recognition-shazam-signature.json'), 'utf8'),
) as Record<string, {
  seconds: number
  number_samples: number
  uri: string
  pcm_sum: number
  pcm_checksum: number
  pcm_first8: number[]
  pcm_last8: number[]
  bands: Record<string, number>
}>

const square = (n: number, period: number): number => (n % period) < Math.floor(period / 2) ? 1 : -1

// 与 Python 侧 mkfixture.gen() 逐点一致的两个易错处：
// - LCG 取模 2^31：Math.imul 只保留低 32 位，而 (X mod 2^32) mod 2^31 == X mod 2^31，所以 & 0x7fffffff 正确
// - (s * env) // 256：Python 的 // 是向下取整，s 可为负，必须用 Math.floor 而不是截断
const fixturePcm = (seconds: number, kind: 'rich' | 'gap' | 'silence'): number[] => {
  const total = 16000 * seconds
  let x = 12345
  const out: number[] = []
  for (let n = 0; n < total; n++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff
    const noise = (((x >>> 16) & 0xff) - 128) * 3
    let v: number
    if (kind === 'silence') {
      v = 0
    } else {
      const inRich = kind === 'gap' ? n < 16000 || n >= 64000 : true
      if (!inRich) {
        v = 0
      } else {
        const s = square(n, 145) * 1200 + square(n, 73) * 900 + square(n, 44) * 700 +
          square(n, 29) * 500 + square(n, 18) * 350 + square(n, 9) * 200 + square(n, 5) * 120
        const am = Math.abs((n % 800) - 400)
        v = Math.floor((s * (256 - Math.floor(am / 2))) / 256) + noise
      }
    }
    out.push(v > 32767 ? 32767 : v < -32768 ? -32768 : v)
  }
  return out
}

const pcmStats = (pcm: number[]) => {
  let sum = 0
  let checksum = 0
  for (const v of pcm) {
    sum += v
    // 先抬成非负再累加：Python 的 % 恒非负、JS 的 % 跟着符号走
    checksum = (checksum + v + 32768) % 4294967296
  }
  return { sum, checksum }
}

test('fixture PCM 生成器与 Python 侧逐点一致', () => {
  const cases: Array<[string, 'rich' | 'gap' | 'silence', number]> = [
    ['rich8', 'rich', 8],
    ['rich2', 'rich', 2],
    ['gap5', 'gap', 5],
    ['silence4', 'silence', 4],
  ]
  for (const [name, kind, seconds] of cases) {
    const pcm = fixturePcm(seconds, kind)
    const { sum, checksum } = pcmStats(pcm)
    assert.equal(sum, fixtures[name].pcm_sum, `${name} 采样总和`)
    assert.equal(checksum, fixtures[name].pcm_checksum, `${name} 逐点校验和`)
    assert.deepEqual(pcm.slice(0, 8), fixtures[name].pcm_first8, `${name} 前 8 点`)
    assert.deepEqual(pcm.slice(-8), fixtures[name].pcm_last8, `${name} 后 8 点`)
  }
})

test('8 秒富谐波输入的签名与 Python 逐字节一致', () => {
  const result = signatureFromPcm16k(Int16Array.from(fixturePcm(8, 'rich')), 8)
  assert.ok(result)
  assert.equal(result!.numberSamples, fixtures.rich8.number_samples)
  assert.equal(result!.uri, fixtures.rich8.uri)
})

test('短输入（2 秒）与空签名（静音 4 秒）也都逐字节一致', () => {
  const short = signatureFromPcm16k(Int16Array.from(fixturePcm(2, 'rich')), 8)
  assert.equal(short!.uri, fixtures.rich2.uri)
  const silent = signatureFromPcm16k(Int16Array.from(fixturePcm(4, 'silence')), 8)
  assert.equal(silent!.uri, fixtures.silence4.uri)
})

test('同频两段之间有噪声时，富谐波长输入已覆盖 fft_pass 的 0xFF 绝对跳转分支', () => {
  const gap = signatureFromPcm16k(Int16Array.from(fixturePcm(5, 'gap')), 8)
  assert.equal(gap!.uri, fixtures.gap5.uri)
})

test('不足 128 点不产出签名（返回 null，交给上层说「没听出来」）', () => {
  assert.equal(signatureFromPcm16k(new Int16Array(127), 8), null)
})

test('3500-5500Hz 频段上游是死条件，永远不产出该段峰', () => {
  // shazamio algorithm.py:258 写的是 `elif 5500 < frequency_hz <= 5500`，恒假。
  // 这个 quirk 必须保留：补上 band 3 会改变签名字节，等于换了一份指纹。
  const uri = signatureFromPcm16k(Int16Array.from(fixturePcm(8, 'rich')), 8)!.uri
  const bytes = Buffer.from(uri.split(',')[1], 'base64')
  const bandIds: number[] = []
  let off = 48 + 8
  while (off + 8 <= bytes.length) {
    bandIds.push(bytes.readUInt32LE(off) - 0x60030040)
    const size = bytes.readUInt32LE(off + 4)
    off += 8 + size + ((4 - (size % 4)) % 4)
  }
  assert.deepEqual(bandIds, [0, 1, 2])
})
