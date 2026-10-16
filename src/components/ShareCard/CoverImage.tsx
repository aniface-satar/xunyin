import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * 分享卡专用的封面。故意不复用 src/components/common/Image：那层没有 onLoad，
 * 而拍摄前必须真的等到图解出来（spec §8 探针 2）。共享组件一行都不改，横屏零风险。
 * 不收 ref —— 被拍的是 ShareCard 最外那一层，这一层只是"报就绪"。
 */
const CoverImage = ({ url, style, resizeMode = 'cover', onReady }: CoverImageProps) => {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const uri = useMemo(() => normalizeCoverUri(url), [url])

  // 换封面（换歌）必须重新等一次 onLoad，否则会把上一首的图解当成已就绪
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [uri])

  const ready = !uri || failed || loaded
  // 同一个 (uri, ready) 只报一次：onReady 的函数身份每次渲染都在变，不锁这个会循环上报
  const reported = useRef<string | null>(null)
  useEffect(() => {
    const token = `${uri}|${ready}`
    if (reported.current === token) return
    reported.current = token
    onReady?.(ready)
  }, [ready, uri, onReady])

  // 卸载时回到未就绪：预览页关掉再为另一首歌打开时，是另一个实例、另一个 true/false 周期，
  // 但 ready 态留在父组件里 —— 这里补一次 false，父组件不会拿着上一首的 true 直接放行拍摄。
  useEffect(() => () => onReady?.(false), [onReady])

  if (!uri) return <View style={style} collapsable={false} />
  return (
    <Image
      style={style}
      source={{ uri, headers: defaultHeaders }}
      resizeMode={resizeMode}
      onLoad={() => { setLoaded(true) }}
      onError={() => { setFailed(true) }}
    />
  )
}

export default CoverImage
