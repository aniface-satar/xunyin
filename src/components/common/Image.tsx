import { useTheme } from '@/store/theme/hook'
import { BorderRadius } from '@/theme'
import { createStyle } from '@/utils/tools'
import { type ComponentProps, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { View, type ViewProps, StyleSheet, Image as FastImage } from 'react-native'
// import FastImage, { type FastImageProps } from 'react-native-fast-image'
import { useLayout } from '@/utils/hooks'
// export type { OnLoadEvent } from 'react-native-fast-image'

export interface ImageProps extends ViewProps {
  style: ComponentProps<typeof FastImage>['style']
  url?: string | number | null
  cache?: boolean
  resizeMode?: ComponentProps<typeof FastImage>['resizeMode']
  onError?: (url: string | number) => void
}


export const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

const EmptyPic = memo(({ style, nativeID }: { style: ImageProps['style'], nativeID: ImageProps['nativeID'] }) => {
  const theme = useTheme()
  const { onLayout, width } = useLayout()
  const size = width * 0.36
  const discColor = theme['c-primary-light-900-alpha-200']
  const grooveColor = theme['c-primary-light-400-alpha-200']
  const holeColor = theme['c-primary-light-100-alpha-200']

  return (
    <View style={StyleSheet.compose({ ...styles.emptyPic, backgroundColor: discColor }, style)} onLayout={onLayout} nativeID={nativeID}>
      <View style={styles.discContainer}>
        <View style={[styles.groove, { width: size * 0.95, height: size * 0.95, borderColor: grooveColor }]} />
        <View style={[styles.groove, { width: size * 0.78, height: size * 0.78, borderColor: grooveColor }]} />
        <View style={[styles.groove, { width: size * 0.62, height: size * 0.62, borderColor: grooveColor }]} />
        <View style={[styles.label, { width: size * 0.35, height: size * 0.35, backgroundColor: grooveColor }]} />
        <View style={[styles.hole, { backgroundColor: holeColor }]} />
      </View>
    </View>
  )
})

const Image = memo(({ url, cache, resizeMode = 'cover', style, onError, nativeID }: ImageProps) => {
  const [isError, setError] = useState(false)
  const handleError = useCallback(() => {
    setError(true)
    onError?.(url!)
  }, [onError, url])
  useEffect(() => {
    setError(false)
  }, [url])
  let uri = typeof url == 'number'
    ? FastImage.resolveAssetSource(url).uri
    : url?.startsWith('/')
      ? 'file://' + url
      : url
  if (__DEV__) console.log('[codex Image]', url, uri)
  const showDefault = useMemo(() => !uri || isError, [isError, uri])
  return (
    showDefault ? <EmptyPic style={style} nativeID={nativeID} />
      : (
          <FastImage
            style={style}
            source={{
              uri: uri!,
              headers: defaultHeaders,
              cache: cache === false ? 'reload' : 'force-cache',
              // priority: FastImage.priority.normal,
              // cache: cache === false ? 'web' : 'immutable',
            }}
            onError={handleError}
            resizeMode={resizeMode}
            nativeID={nativeID}
          />
        )
  )
}, (prevProps, nextProps) => {
  return prevProps.url == nextProps.url &&
    prevProps.style == nextProps.style &&
    prevProps.nativeID == nextProps.nativeID
})

export const getSize = (uri: string, success: (width: number, height: number) => void, failure?: (error: any) => void) => {
  FastImage.getSize(uri, success, failure)
}
export const clearMemoryCache = async() => {
  // return Promise.all([FastImage.clearMemoryCache(), FastImage.clearDiskCache()])
}
export default Image

const styles = createStyle({
  emptyPic: {
    borderRadius: BorderRadius.normal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  groove: {
    borderRadius: 9999,
    borderWidth: 1,
    position: 'absolute',
  },
  label: {
    borderRadius: 9999,
    position: 'absolute',
  },
  hole: {
    width: 6,
    height: 6,
    borderRadius: 9999,
    position: 'absolute',
  },
})
