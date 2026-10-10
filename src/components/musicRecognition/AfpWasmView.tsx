import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import RNFS from 'react-native-fs'
import { createStyle } from '@/utils/tools'
import { clearWasmRequester, setWasmRequester } from '@/core/musicRecognition/wasmBridge'

const WASM_ASSET = 'recognition/afp.wasm'
const GLUE_ASSET = 'recognition/afp-glue.js'
const REQUEST_TIMEOUT_MS = 15000

interface Assets { wasmB64: string, glue: string }
interface Pending { resolve: (value: string) => void, reject: (reason: Error) => void, timer: ReturnType<typeof setTimeout> }
interface BridgeMessage { ready?: boolean, id?: string, ok?: boolean, data?: string, error?: string }

// wasm base64 约 308KB、胶水约 89KB，注入一次就常驻；每次识别都重建的话光注入就够慢
// 缓存「在途 Promise」而不是结果：同步赋值，既不会有两个实例各读一遍 assets，
// 也不会因为 await 之后再写字段而踩到 require-atomic-updates。
let cachedAssetsPromise: Promise<Assets> | null = null
const loadAssets = async(): Promise<Assets> => {
  if (!cachedAssetsPromise) {
    cachedAssetsPromise = Promise.all([
      RNFS.readFileAssets(WASM_ASSET, 'base64'),
      RNFS.readFileAssets(GLUE_ASSET, 'utf8'),
    ]).then(([wasmB64, glue]) => ({ wasmB64, glue }))
  }
  return cachedAssetsPromise
}

const bootScript = (assets: Assets): string => {
  const url = 'data:application/octet-stream;base64,' + assets.wasmB64
  return 'window.__AFP_URL__ = ' + JSON.stringify(url) + ';\n' +
    'var __afpModule = { exports: {} };\n' +
    '(function(module, exports, require){\n' + assets.glue + '\n})' +
    '(__afpModule, __afpModule.exports, function(){ throw new Error("require is not available"); });\n' +
    'window.__ask = function(id, samplesB64) {\n' +
    '  var send = function(payload) { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); };\n' +
    '  try {\n' +
    '    Promise.resolve(__afpModule.exports.Encode8kB64(samplesB64)).then(\n' +
    '      function(fp) { send({ id: id, ok: true, data: fp }); },\n' +
    '      function(err) { send({ id: id, ok: false, error: String(err) }); }\n' +
    '    );\n' +
    '  } catch (e) { send({ id: id, ok: false, error: String(e) }); }\n' +
    '};\n' +
    'window.ReactNativeWebView.postMessage(JSON.stringify({ ready: typeof window.__ask === "function" }));\n' +
    'true;'
}

/**
 * 隐藏 WebView：加载 afp.wasm 与打补丁的胶水，把 8kHz 样本换成指纹字符串。
 * 只负责算指纹，不碰麦克风、不联网。
 */
export default () => {
  const webViewRef = useRef<WebView>(null)
  const pending = useRef(new Map<string, Pending>())
  const seq = useRef(0)
  const booted = useRef(false)
  const assetsRef = useRef<Assets | null>(null)
  const [source, setSource] = useState<{ html: string } | null>(null)

  // 身份必须跨渲染稳定：注册进单例的是它本身，卸载时要按同一个引用注销。
  // 少这一层 useCallback，setSource 触发重渲染后「注册的那一个」和「注销的那一个」
  // 就不是同一个函数，注销永远失败、桥会一直指向已经死掉的 WebView。
  // 只读 ref，所以空依赖是诚实的。
  const requestFingerprint = useCallback(async(samplesB64: string): Promise<string> => new Promise((resolve, reject) => {
    if (!booted.current) {
      reject(new Error('fingerprint webview is not ready'))
      return
    }
    seq.current += 1
    const id = String(seq.current)
    const timer = setTimeout(() => {
      pending.current.delete(id)
      reject(new Error('fingerprint timeout'))
    }, REQUEST_TIMEOUT_MS)
    pending.current.set(id, { resolve, reject, timer })
    // id 与 samples 一律 JSON.stringify：桥的另一端是 eval 语义的字符串注入，
    // 手工转义迟早漏，JSON 字面量不会。
    const code = 'window.__ask(' + JSON.stringify(id) + ',' + JSON.stringify(samplesB64) + '); true;'
    try {
      webViewRef.current?.injectJavaScript(code)
    } catch (err) {
      clearTimeout(timer)
      pending.current.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  }), [])

  useEffect(() => {
    // useRef 的 current 从不重新赋值，这里取到的一直是同一个 Map；
    // 先存成局部，免得 lint 以为清理函数读到了过期的 ref（它没有）。
    const pendingRequests = pending.current
    void loadAssets().then(assets => {
      assetsRef.current = assets
      // 空壳文档：真正的脚本注入走 onLoadEnd，避免把 308KB base64 塞进 HTML
      setSource({ html: '<html><head><meta charset="utf-8"></head><body></body></html>' })
    }, () => {
      // iOS 上没有 assets 目录，这里必然走到：不挂 WebView、不注册 requester，
      // 于是 fingerprintFromWasm 大声抛「not ready」，任何 await 都不会悬着。
      if (__DEV__) console.log('[recognition] wasm assets unavailable')
    })
    return () => {
      booted.current = false
      clearWasmRequester(requestFingerprint)
      for (const item of pendingRequests.values()) {
        clearTimeout(item.timer)
        // 卸载时绝不能只 clearTimeout：那样 await 的 Promise 永远不结算，
        // recognizeWithEngines 不返回，Task 8 的 UI 会停在「正在听」转个不停，
        // 而每日额度已经被 guard.onAttempt() 扣掉了。必须显式 reject。
        item.reject(new Error('fingerprint webview unmounted'))
      }
      pendingRequests.clear()
    }
  }, [requestFingerprint])

  const handleLoadEnd = () => {
    if (booted.current) return // onLoadEnd 在 Android 上可能触发多次，注入必须幂等
    const assets = assetsRef.current
    if (!assets) return
    webViewRef.current?.injectJavaScript(bootScript(assets))
  }

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: BridgeMessage
    try {
      message = JSON.parse(event.nativeEvent.data) as BridgeMessage
    } catch {
      return
    }
    if (message.ready != null) {
      if (message.ready) {
        booted.current = true
        setWasmRequester(requestFingerprint)
      } else if (__DEV__) {
        console.log('[recognition] glue boot failed')
      }
      return
    }
    const id = message.id
    if (!id) return
    const item = pending.current.get(id)
    if (!item) return
    pending.current.delete(id)
    clearTimeout(item.timer)
    if (message.ok && typeof message.data == 'string') item.resolve(message.data)
    else item.reject(new Error(message.error ?? 'fingerprint failed'))
  }

  if (!source) return <View style={styles.hidden} />

  return (
    <View pointerEvents="none" style={styles.hidden}>
      <WebView
        ref={webViewRef}
        source={source}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={false}
        originWhitelist={['*']}
        onError={() => { if (__DEV__) console.log('[recognition] webview load error') }}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
      />
    </View>
  )
}

// 用 1×1 + opacity 0 而不是 display:none / 0×0：后者在部分 Android WebView 版本上不保证创建 JS 上下文
const styles = createStyle({
  hidden: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  webview: {
    width: 1,
    height: 1,
    backgroundColor: 'transparent',
  },
})
