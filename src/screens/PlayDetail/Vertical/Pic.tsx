import { useCallback, useMemo, useState, useEffect } from 'react'
import { ActivityIndicator, Pressable, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native'

import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { createStyle, toast } from '@/utils/tools'
import { useI18n } from '@/lang'
import { saveCover } from '@/utils/shareCard/saveCover'
import { useWindowSize } from '@/utils/hooks'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { HEADER_HEIGHT } from './components/Header'
import { FULL_COVER_RADIUS, getPlayDetailLayout } from './layout'
import MusicInfo, { type MusicInfoLayout } from './Player/components/MusicInfo'
import Image from '@/components/common/Image'
import { useStatusbarHeight } from '@/store/common/hook'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'


export interface CoverLayout {
  x: number
  y: number
  width: number
  height: number
}

export default ({
  onMusicInfoLayout,
  marqueeActive = true,
  onCoverLayout,
}: {
  onMusicInfoLayout?: (layout: MusicInfoLayout) => void
  marqueeActive?: boolean
  onCoverLayout?: (layout: CoverLayout) => void
} = {}) => {
  const musicInfo = usePlayerMusicInfo()
  const theme = useTheme()
  const t = useI18n()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const [pic, setPic] = useState(musicInfo.pic)
  const [saveVisible, setSaveVisible] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPic(musicInfo.pic)
  }, [musicInfo.pic])

  // 切歌后上一首的保存按钮不该留在新封面上
  useEffect(() => {
    setSaveVisible(false)
  }, [musicInfo.pic])

  const handleCoverLongPress = useCallback(() => {
    if (saving) return
    if (!musicInfo.pic) {
      toast(t('play_detail_cover_save_empty'))
      return
    }
    setSaveVisible(visible => !visible)
  }, [musicInfo.pic, saving, t])

  const handleSaveCover = useCallback(async() => {
    const currentPic = musicInfo.pic
    if (saving || !currentPic) return
    setSaving(true)
    try {
      const name = await saveCover({ pic: currentPic, name: musicInfo.name, singer: musicInfo.singer })
      // null = 用户在文件夹选择器里取消了，不叫失败，也不该说"已保存"
      if (name) {
        toast(t('share_card_saved', { name }))
        setSaveVisible(false)
      } else {
        toast(t('share_card_save_canceled'))
      }
    } catch (err) {
      console.error('[cover_save] failed', err)
      toast(t('share_card_save_failed'))
    } finally {
      setSaving(false)
    }
  }, [musicInfo.name, musicInfo.pic, musicInfo.singer, saving, t])

  const { coverSize, coverGap } = useMemo(() => getPlayDetailLayout(
    winWidth,
    winHeight,
    statusBarHeight + HEADER_HEIGHT,
  ), [statusBarHeight, winHeight, winWidth])

  // 上报封面在 Pic 容器内的实际布局值：onLayout 是 Yoga 像素取整后的结果，
  // 动画层用它做端点才能和静态封面逐像素对齐（相对坐标不受转场 transform 影响）
  const handleCoverLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout
    onCoverLayout?.({ x, y, width, height })
  }, [onCoverLayout])

  return (
    <View style={styles.container}>
      <View
        onLayout={handleCoverLayout}
        collapsable={false}
        style={{
          ...styles.content,
          marginTop: coverGap,
          backgroundColor: theme['c-content-background'],
        }}
      >
        <Pressable
          onPress={() => { setSaveVisible(false) }}
          onLongPress={handleCoverLongPress}
          delayLongPress={400}
        >
          <Image
            url={pic}
            nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic}
            style={{
              width: coverSize,
              height: coverSize,
              borderRadius: FULL_COVER_RADIUS,
              borderWidth: BorderWidths.normal,
              borderColor: theme['c-border-background'],
            }}
          />
        </Pressable>
        {saveVisible
          ? (
              <TouchableOpacity
                style={styles.saveBtn}
                activeOpacity={0.7}
                disabled={saving}
                onPress={handleSaveCover}
                accessibilityRole="button"
                accessibilityLabel={t('play_detail_cover_save')}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" style={styles.saveIcon} />
                  : <Icon name="download-2" size={14} color="#fff" style={styles.saveIcon} />
                }
                <Text size={13} color="#fff" style={styles.saveText}>{t('play_detail_cover_save')}</Text>
              </TouchableOpacity>
            )
          : null}
      </View>
      <MusicInfo onLayoutChange={onMusicInfoLayout} marqueeActive={marqueeActive} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  content: {
    backgroundColor: 'rgba(0,0,0,0)',
    borderRadius: FULL_COVER_RADIUS,
    elevation: 18,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
  },
  saveBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.66)',
  },
  saveIcon: {
    marginRight: 6,
  },
  saveText: {
    includeFontPadding: false,
  },
})

