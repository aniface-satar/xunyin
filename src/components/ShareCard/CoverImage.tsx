import { useEffect, useRef, useState } from 'react'
import { Image, type ImageStyle, type StyleProp, View } from 'react-native'

import { defaultHeaders } from '@/components/common/Image'

export interface CoverImageProps {
  url: string | null | undefined
  style: StyleProp<ImageStyle>
  resizeMode?: 'cover' | 'contain' | 'stretch'
  /** 就绪 = 图已解出来 / 根本没有图 / 图坏了。后两种也算就绪，否则导出会永远卡在"正在准备"。 */
  onReady?: (ready: boolean) => void
}

export const normalizeCoverUri = (url: string | null | undefined): string | null => {
  if (!url) return null
  return url.startsWith('/') ? 'file://' + url : url
}

interface LoadState { uri: string | null, loaded: boolean, failed: boolean }

/**
 * 分享卡专用的封面。故意不复用 src/components/common/Image：那层没有 onLoad，
 * 而拍摄前必须真的等到图解出来（spec §8 探针 2）。共享组件一行都不改，横屏零风险。
 * 不收 ref —— 被拍的是 ShareCard 最外那一层，这一层只是"报就绪"。
 */
const CoverImage = ({ url, style, resizeMode = 'cover', onReady }: CoverImageProps) => {
  const uri = normalizeCoverUri(url)
  // 加载结果和"它属于哪一张封面"绑在同一个 state 里。换封面时 ready 必须在**渲染那一刻**就变 false：
  // 复位若写成 useEffect(..., [uri])，两个 effect 在同一次 passive flush 里按声明顺序跑，
  // 上报那条会先看到 `uri=B, loaded=true`，于是给一张没解过码的 B 报了一次 true，
  // 纠正的 false 要晚一整个渲染才到。Task 6 若写 `if (ready && pending) shoot()`，
  // 拍到的就是上一首的图（Fresco 换源时保留旧 drawable）—— 那是把产物悄悄拍错，不是抖一下。
  // 渲染期 setState 是 React 官方给的"prop 变化时调整 state"写法：React 立刻用新 state 重跑一次渲染，
  // 不提交这一帧，那一帧的 true 就出不去。
  const [state, setState] = useState<LoadState>({ uri, loaded: false, failed: false })
  if (state.uri !== uri) setState({ uri, loaded: false, failed: false })

  const ready = !uri || state.failed || state.loaded

  // onReady 只按"最新那一次"取用，绝不进任何依赖数组：父组件每次渲染都换新箭头，
  // 若把它挂进卸载清理的 deps，清理会在它还活着的时候反复跑，把父组件的 ready 永久钉死在 false ——
  // 而无封面那条路 ready 恒真、上报 token 挂载时就消费掉了，再也没有 transition 能把它救回来，
  // 正好是最该避免的"导出永远卡在正在准备"。
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // 同一个 (uri, ready) 只报一次
  const reported = useRef<string | null>(null)
  useEffect(() => {
    const token = `${uri}|${ready}`
    if (reported.current === token) return
    reported.current = token
    onReadyRef.current?.(ready)
  }, [ready, uri])

  // 卸载时回到未就绪：预览页关掉再为另一首歌打开时是另一个实例，但 ready 态留在父组件里，
  // 这里补一次 false，父组件不会拿着上一首的 true 直接放行拍摄。deps 为空 = 真的只在卸载跑。
  useEffect(() => () => { onReadyRef.current?.(false) }, [])

  if (!uri) return <View style={style} collapsable={false} />
  return (
    <Image
      key={uri}
      style={style}
      source={{ uri, headers: defaultHeaders }}
      resizeMode={resizeMode}
      // key={uri} 是这条判据成立的前提：RN 的原生事件只认"当前挂着的视图"，换源不重挂的话
      // 上一首那张贴图晚到的 onLoad 会打到这一首的回调上，s.uri 与 uri 都是新的、判据照样放行，
      // 于是把没解完的封面报成就绪。按 uri 重挂之后旧请求的事件落在已卸载的视图上（被静默丢弃），
      // 顺带也让 Fresco 不再把上一张 drawable 留在原位。setState 那层判据留着，管 A→B→C 的连换。
      onLoad={() => { setState(s => s.uri === uri ? { ...s, loaded: true } : s) }}
      onError={() => { setState(s => s.uri === uri ? { ...s, failed: true } : s) }}
    />
  )
}

export default CoverImage
