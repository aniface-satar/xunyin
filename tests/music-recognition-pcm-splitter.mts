import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NCM_SAMPLE_RATE,
  NCM_TARGET_RATE,
  WINDOW_FROM_SECONDS,
  WINDOW_LEN_SECONDS,
  decimate,
  toLittleEndianBytes,
} from '../src/core/musicRecognition/pcmSplitter.ts'
import { SHAZAM_SAMPLE_RATE } from '../src/core/musicRecognition/shazamSignature.ts'

// 上游胶水 toNCMBuffer 的取样公式：json[now] = buf[now * sampleRate / target + from * sampleRate]
// 这里独立复写一遍公式，作为被测实现的参照物
const glueReference = (pcm: Int16Array, sampleRate: number, targetRate: number, fromSeconds: number, lenSeconds: number): Int16Array => {
  const out = new Int16Array(lenSeconds * targetRate)
  for (let now = 0; now < lenSeconds * targetRate; now++) {
    out[now] = pcm[now * sampleRate / targetRate + fromSeconds * sampleRate]
  }
  return out
}

const makeRamp = (length: number): Int16Array => {
  const pcm = new Int16Array(length)
  for (let i = 0; i < length; i++) pcm[i] = (i % 65536) - 32768
  return pcm
}

test('48k -> 8k 的取样索引与上游胶水公式逐点相等', () => {
  const pcm = makeRamp(8 * NCM_SAMPLE_RATE)
  const actual = decimate(pcm, NCM_SAMPLE_RATE, NCM_TARGET_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  const expected = glueReference(pcm, NCM_SAMPLE_RATE, NCM_TARGET_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  assert.equal(actual.length, WINDOW_LEN_SECONDS * NCM_TARGET_RATE)
  assert.deepEqual(Array.from(actual), Array.from(expected))
})

// 引擎自己降采样后，同一个函数要能服务两个目标率：Shazam 吃 16k，步长是每 3 个取 1 个。
// 这条同时锁住「没有为某个引擎偷偷特判」。
test('48k -> 16k 走的是同一套公式：每 3 个取 1 个，窗口定长 6 秒', () => {
  const pcm = makeRamp(8 * NCM_SAMPLE_RATE)
  const out = decimate(pcm, NCM_SAMPLE_RATE, SHAZAM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  assert.equal(out.length, WINDOW_LEN_SECONDS * SHAZAM_SAMPLE_RATE)
  assert.equal(out[0], pcm[NCM_SAMPLE_RATE])
  assert.equal(out[1], pcm[NCM_SAMPLE_RATE + 3])
  assert.equal(out[100], pcm[NCM_SAMPLE_RATE + 300])
  const expected = glueReference(pcm, NCM_SAMPLE_RATE, SHAZAM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  assert.deepEqual(Array.from(out), Array.from(expected))
})

test('跳过的秒数确实被跳过：from=0 与 from=1 不同，且 from=1 从第 48000 个样本开始', () => {
  const pcm = makeRamp(8 * NCM_SAMPLE_RATE)
  const from0 = decimate(pcm, NCM_SAMPLE_RATE, NCM_TARGET_RATE, 0, 1)
  const from1 = decimate(pcm, NCM_SAMPLE_RATE, NCM_TARGET_RATE, 1, 1)
  assert.equal(from1[0], pcm[NCM_SAMPLE_RATE])
  assert.notEqual(from0[0], from1[0])
})

test('最短的负值 -32768 不被截断或溢出', () => {
  const pcm = new Int16Array(6 * NCM_SAMPLE_RATE).fill(-32768)
  const out = decimate(pcm, NCM_SAMPLE_RATE, NCM_TARGET_RATE, 0, 6)
  assert.equal(out[0], -32768)
  assert.equal(out[out.length - 1], -32768)
})

test('录音比窗口短的部分补 0，不越界读取', () => {
  const pcm = new Int16Array(2 * NCM_SAMPLE_RATE).fill(1234)
  const out = decimate(pcm, NCM_SAMPLE_RATE, NCM_TARGET_RATE, 1, 6)
  // from=1s、len=6s 需要覆盖到第 7 秒，只有前 1 秒有数据
  assert.equal(out[0], 1234)
  assert.equal(out[NCM_TARGET_RATE - 1], 1234)
  assert.equal(out[NCM_TARGET_RATE], 0)
  assert.equal(out[out.length - 1], 0)
})

test('输出是小端 Int16 字节，不依赖宿主字节序', () => {
  const bytes = toLittleEndianBytes(new Int16Array([-2, 1, -32768, 32767]))
  assert.deepEqual(Array.from(bytes), [0xfe, 0xff, 0x01, 0x00, 0x00, 0x80, 0xff, 0x7f])
})

test('空输入返回全 0 的定长窗口', () => {
  const out = decimate(new Int16Array(0), NCM_SAMPLE_RATE, NCM_TARGET_RATE, 0, 6)
  assert.equal(out.length, WINDOW_LEN_SECONDS * NCM_TARGET_RATE)
  assert.equal(out[0], 0)
})
