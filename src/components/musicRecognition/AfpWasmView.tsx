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
 * 挂载位置：RecognizePanel 内，只在 implemented 的引擎标签打开时存在。
 * 代价是每次进页重注入一次（assets 有模块级缓存，省掉重复读 308KB）；换来的是从不进识曲页的
 * 设备不必常驻一个 WebView 和它的 wasm 堆。因此调用方必须先问 isWasmReady() 再开始录：
 * 桥没就绪时 provider 已经扣掉每日额度了，白录 8 秒还白花钱。
 */
const AfpWasmView = () => {
  const webViewRef = useRef<WebView>(null)
  const pending = useRef(new Map<string, Pending>())
  const seq = useRef(0)
  const booted = useRef(false)
  const injected = useRef(false)
  const mounted = useRef(false)
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

  // 上下文一没，在途请求必须当场结算。只 clearTimeout 的话 await 它的 Promise 永远不落，
  // recognizeWithEngines 不返回，UI 停在「正在听」转个不停，而额度已经被 guard.onAttempt() 扣掉。
  const rejectPending = useCallback((reason: string) => {
    for (const item of pending.current.values()) {
      clearTimeout(item.timer)
      item.reject(new Error(reason))
    }
    pending.current.clear()
  }, [])

  // 闩要打在「注入」这个动作上，不能打在 ready 回包上：回包是一次异步往返，
  // 在此之前连续到来的两次 onLoadEnd 都会读成「还没注入」，于是整段 bootScript
  // （308KB data URL + 89KB 胶水）被注入两遍，换来两份 wasm 堆和两个 ready。
  // 页面重置时把它拨回 false，所以「幂等」不等于「永不重试」。
  const resetBridge = useCallback(() => {
    booted.current = false
    injected.current = false
    rejectPending('fingerprint webview reset')
  }, [rejectPending])

  useEffect(() => {
    mounted.current = true
    void loadAssets().then(assets => {
      assetsRef.current = assets
      // 空壳文档：真正的脚本注入走 onLoadEnd，避免把 308KB base64 塞进 HTML
      if (mounted.current) setSource({ html: '<html><head><meta charset="utf-8"></head><body></body></html>' })
    }, () => {
      // iOS 上没有 assets 目录，这里必然走到：不挂 WebView、不注册 requester，
      // 于是 fingerprintFromWasm 大声抛「not ready」，任何 await 都不会悬着。
      if (__DEV__) console.log('[recognition] wasm assets unavailable')
    })
    return () => {
      mounted.current = false
      booted.current = false
      injected.current = false
      clearWasmRequester(requestFingerprint)
      rejectPending('fingerprint webview unmounted')
    }
  }, [requestFingerprint, rejectPending])

  const handleLoadEnd = () => {
    const assets = assetsRef.current
    if (!assets) return
    if (injected.current) return
    injected.current = true
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
        // 清理已经跑过一次的话，这里注册进去的就是一个没有主人的 WebView：
        // 桥会一直「就绪」，而每次识别都白等满 15s 超时。
        if (!mounted.current) return
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

  if (!source) return <View pointerEvents="none" style={styles.hidden} />

  return (
    <View pointerEvents="none" style={styles.hidden}>
      <WebView
        ref={webViewRef}
        source={source}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={false}
        originWhitelist={['*']}
        onError={() => {
          if (__DEV__) console.log('[recognition] webview load error')
          // 主文档挂了 = 页面里没有 __ask。不作废闩的话 booted 一直是真的，
          // 之后每次识别都只会在 15s 超时里失败。原生随后还会发 onLoadEnd，那时再注入。
          resetBridge()
        }}
        onRenderProcessGone={() => {
          if (__DEV__) console.log('[recognition] webview render process gone')
          resetBridge()
          // renderer 被系统杀掉后页面是空白的，不会再有 onLoadEnd 来敲门，只能自己重载一次
          webViewRef.current?.reload()
        }}
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

export default AfpWasmView
