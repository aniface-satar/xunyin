// RN 与隐藏 WebView 之间的唯一接缝。桥只能传字符串，
// 所以 Int16Array/Float32Array 一律在 WebView 上下文里构造。
export type WasmRequester = (samplesB64: string) => Promise<string>

let requester: WasmRequester | null = null

export const setWasmRequester = (fn: WasmRequester | null) => {
  requester = fn
}

// 注销必须认出「注销的是不是我自己」：转场时新旧两个 AfpWasmView 会短暂共存，
// 旧实例卸载时若无条件清空单例，会把新实例刚注册的 requester 一并抹掉，
// 之后每次识别都报「fingerprint webview is not ready」，且看不出原因。
export const clearWasmRequester = (fn: WasmRequester) => {
  if (requester === fn) requester = null
}

export const isWasmReady = (): boolean => requester != null

export const fingerprintFromWasm = async(samplesB64: string): Promise<string> => {
  if (!requester) throw new Error('fingerprint webview is not ready')
  return requester(samplesB64)
}
