import { Fragment, memo, useRef } from 'react'
import { TouchableOpacity, View } from 'react-native'

import { pop } from '@/navigation'
import StatusBar from '@/components/common/StatusBar'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT as _HEADER_HEIGHT, NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import commonState from '@/store/common/state'
import { useStatusbarHeight } from '@/store/common/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import playerState from '@/store/player/state'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { createStyle, shareMusic } from '@/utils/tools'
import LyricSettingSheet, { type LyricSettingSheetType } from './LyricSettingSheet'

export const HEADER_HEIGHT = scaleSizeH(_HEADER_HEIGHT)

interface HeaderProps {
  onBack?: () => void
  pageIndex?: number
  onPageSelected?: (page: number) => void
}

const PAGE_NAMES = ['歌曲', '歌词'] as const
const LYRIC_PAGE = 1

export default memo(({ onBack, pageIndex = 0, onPageSelected }: HeaderProps) => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()
  const glassColors = useGlassColors()
  const playMusicInfo = usePlayMusicInfo()
  const settingSheetRef = useRef<LyricSettingSheetType>(null)
  const shareType = useSettingValue('common.shareType')
  const downloadFileName = useSettingValue('download.fileName')
  const isLyricPage = pageIndex == LYRIC_PAGE

  const back = () => {
    if (onBack) {
      onBack()
      return
    }
    void pop(commonState.componentIds.playDetail!)
  }

  const share = () => {
    const currentMusic = playerState.playMusicInfo.musicInfo ?? playMusicInfo.musicInfo
    if (!currentMusic) return
    shareMusic(
      shareType,
      downloadFileName,
      'progress' in currentMusic ? currentMusic.metadata.musicInfo : currentMusic,
    )
  }

  const showSetting = () => {
    settingSheetRef.current?.show()
  }

  return (
    <View style={{ height: HEADER_HEIGHT + statusBarHeight, paddingTop: statusBarHeight }} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_header}>
      <StatusBar />
      <View style={styles.container}>
        <View style={styles.tabs}>
          {
            PAGE_NAMES.map((name, index) => (
              <Fragment key={name}>
                {
                  index > 0 && <View style={[styles.separator, { backgroundColor: theme['c-border-background'] }]} />
                }
                <TouchableOpacity
                  style={styles.tab}
                  activeOpacity={0.7}
                  onPress={() => onPageSelected?.(index)}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.tabText,
                      { color: index == pageIndex ? glassColors.text : glassColors.muted },
                      index == pageIndex ? styles.tabTextActive : null,
                    ]}
                  >
                    {name}
                  </Text>
                </TouchableOpacity>
              </Fragment>
            ))
          }
        </View>
        {
          isLyricPage && (
            <TouchableOpacity style={[styles.sideBtn, styles.settingBtn]} activeOpacity={0.7} onPress={showSetting}>
              <Icon name="slider" size={19} color={glassColors.text} />
            </TouchableOpacity>
          )
        }
        <TouchableOpacity style={[styles.sideBtn, styles.shareBtn]} activeOpacity={0.7} onPress={share}>
          <Icon name="share" size={19} color={glassColors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.sideBtn, styles.backBtn]} activeOpacity={0.7} onPress={back}>
          <Icon
            name="chevron-left"
            size={20}
            color={glassColors.text}
            style={styles.downIcon}
          />
        </TouchableOpacity>
      </View>
      <LyricSettingSheet ref={settingSheetRef} />
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    height: '100%',
    position: 'relative',
    alignItems: 'center',
  },
  sideBtn: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: 48,
  },
  backBtn: {
    position: 'absolute',
    left: 0,
  },
  settingBtn: {
    position: 'absolute',
    right: 48,
  },
  shareBtn: {
    position: 'absolute',
    right: 0,
  },
  downIcon: {
    transform: [{ rotate: '-90deg' }],
  },
  tabs: {
    alignItems: 'center',
    flexDirection: 'row',
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'center',
  },
  tab: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  tabText: {
    fontSize: 15,
    includeFontPadding: false,
  },
  tabTextActive: {
    fontWeight: '700',
  },
  separator: {
    height: 16,
    width: 1,
  },
})
