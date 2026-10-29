import { memo, useEffect, useMemo, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { BorderWidths } from '@/theme'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { LoveIcon } from '@/components/common/LoveIcon'
import Text, { AnimatedText } from '@/components/common/Text'
import { createStyle, shareSonglist } from '@/utils/tools'
import { pop } from '@/navigation'
import Image from '@/components/common/Image'
import ArtistPickerSheet from '@/components/ArtistPickerSheet'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useArtistPicker } from '@/utils/hooks/useArtistPicker'
import { useListInfo } from './state'
import { useAnimateOnecNumber } from '@/utils/hooks/useAnimateNumber'
import { useStatusbarHeight } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { handleCollect, isSameSourceList } from './listAction'
import { useMyList } from '@/store/list/hook'
import ActionBar from './ActionBar'

const IMAGE_WIDTH = scaleSizeW(70)

const CountText = memo(({ count }: { count: string }) => {
  const [animFade] = useAnimateOnecNumber(0, 1, 250, false)
  const [animTranslateY] = useAnimateOnecNumber(10, 0, 250, false)
  return (
    <AnimatedText style={{
      ...styles.playCount,
      opacity: animFade,
      transform: [
        { translateY: animTranslateY },
      ],
    }} numberOfLines={ 1 }>{count}</AnimatedText>
  )
}, (prevProps, nextProps) => {
  return true
})

const Pic = ({ playCount, imgUrl }: {
  playCount: string
  imgUrl?: string
}) => {
  const [pic, setPic] = useState(imgUrl)
  const animated = true
  useEffect(() => {
    setPic(imgUrl)
  }, [imgUrl])

  return (
    <View style={{ ...styles.listItemImg, width: IMAGE_WIDTH, height: IMAGE_WIDTH }}>
      <Image url={pic} style={{ flex: 1, borderRadius: 4 }} />
      {
        playCount && animated ? <CountText count={playCount} /> : null
      }
    </View>
  )
}

export interface HeaderProps {
  componentId: string
  embedded?: boolean
  onBack?: () => void
  isMultiSelectMode?: boolean
  onToggleMultiSelect?: () => void
  detailInfo: DetailInfo
  // 专辑页隐藏封面右侧简介（简介移到下方「介绍」标签），歌单页保持原样
  hideDesc?: boolean
  // 专辑页不提供「加入自建歌单」
  hideActionBar?: boolean
  // 上报首行（返回 / 分享 / 收藏）的高度，歌单页据此决定吸顶标题栏何时出现
  onTopRowLayout?: (height: number) => void
}

export interface DetailInfo {
  name: string
  author?: string
  desc: string
  playCount: string
  imgUrl?: string
}

export default memo(({ componentId, embedded, onBack, isMultiSelectMode = false, onToggleMultiSelect, detailInfo, hideDesc = false, hideActionBar = false, onTopRowLayout }: HeaderProps) => {
  const fullStatusBarHeight = useStatusbarHeight()
  const theme = useTheme()
  const t = useI18n()
  const shareType = useSettingValue('common.shareType')
  const info = useListInfo()
  const allList = useMyList()
  const { sheetRef: artistSheetRef, openArtist } = useArtistPicker()
  const canOpenArtist = !!detailInfo.author
  const statusBarHeight = embedded ? 0 : fullStatusBarHeight

  const back = () => {
    if (onBack) {
      onBack()
    } else {
      void pop(componentId)
    }
  }

  const share = () => {
    if (!detailInfo.name) return
    shareSonglist(shareType, detailInfo.name, detailInfo.desc)
  }

  const isLoved = useMemo(() => {
    return allList.some(item => 'sourceListId' in item && isSameSourceList(item, info.source, info.id) && !!item.isLove)
  }, [allList, info.id, info.source])

  const collect = () => {
    if (!detailInfo.name) return
    void handleCollect(info.id, info.source, detailInfo.name || info.name)
  }

  return (
    <View style={{ ...styles.container, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
      <View
        style={styles.topRow}
        onLayout={onTopRowLayout
          ? e => { onTopRowLayout(e.nativeEvent.layout.height) }
          : undefined}
      >
        <TouchableOpacity
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={global.i18n.t('back')}
          activeOpacity={0.7}
          onPress={back}
        >
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            activeOpacity={0.7}
            onPress={share}
            accessibilityRole="button"
            accessibilityLabel={t('share_songlist')}
          >
            <Icon name="share" size={19} color={theme['c-font']} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            activeOpacity={0.7}
            onPress={collect}
            accessibilityRole="button"
            accessibilityLabel={t('collect_songlist')}
          >
            <LoveIcon filled={isLoved} size={19} color={theme['c-font']} />
          </TouchableOpacity>
          {
            onToggleMultiSelect
              ? (
                <TouchableOpacity
                  style={styles.multiSelectBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                  activeOpacity={0.7}
                  onPress={onToggleMultiSelect}
                >
                  <Text size={14} color={theme['c-primary']}>{t(isMultiSelectMode ? 'list_select_cancel' : 'mylist_multi_select')}</Text>
                </TouchableOpacity>
                )
              : null
          }
        </View>
      </View>
      <View style={{ ...styles.infoRow, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
        <Pic playCount={detailInfo.playCount} imgUrl={detailInfo.imgUrl} />
        <View style={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, paddingLeft: 5 }} nativeID={NAV_SHEAR_NATIVE_IDS.songlistDetail_title}>
          <Text size={14} numberOfLines={ 1 }>{detailInfo.name}</Text>
          {
            detailInfo.author
              ? (
                <TouchableOpacity
                  style={styles.artistRow}
                  activeOpacity={0.7}
                  disabled={!canOpenArtist}
                  onPress={() => {
                    openArtist({ source: info.source, singer: detailInfo.author! })
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={detailInfo.author}
                >
                  <Text style={styles.artistName} size={12} color={theme['c-font-label']} numberOfLines={1}>{detailInfo.author}</Text>
                  {
                    canOpenArtist
                      ? <Icon name="chevron-right" size={12} color={theme['c-font-label']} style={styles.artistArrow} />
                      : null
                  }
                </TouchableOpacity>
                )
              : null
          }
          {
            hideDesc
              ? null
              : (
                <View style={{ flexGrow: 0, flexShrink: 1 }}>
                  <Text size={13} color={theme['c-font-label']} numberOfLines={ 4 }>{detailInfo.desc}</Text>
                </View>
                )
          }
        </View>
      </View>
      {hideActionBar ? null : <ActionBar name={detailInfo.name || info.name} />}
      <ArtistPickerSheet ref={artistSheetRef} />
      {/* <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexGrow: 0, flexShrink: 1, paddingTop: 5, paddingRight: 5 }}>
              <Text style={{ fontSize: 12, color: AppColors.normal20 }} numberOfLines={ 1 }>{playCount || '-'}</Text>
              <Text style={{ fontSize: 12, color: AppColors.normal30 }} numberOfLines={ 1 }>{this.props.selectListInfo.author || this.props.listDetailData.info.author}</Text>
            </View>
      </View> */}
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    borderBottomWidth: BorderWidths.normal,
  },
  infoRow: {
    flexDirection: 'row',
    flexGrow: 0,
    flexShrink: 0,
  },
  artistRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 2,
  },
  artistName: {
    flexShrink: 1,
  },
  artistArrow: {
    marginLeft: 2,
  },
  topRow: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 38,
    height: 28,
    marginLeft: 10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  actionBtn: {
    width: 34,
    height: 28,
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiSelectBtn: {
    height: 28,
    marginLeft: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listItemImg: {
    // backgroundColor: '#eee',
    flexGrow: 0,
    flexShrink: 0,
    overflow: 'hidden',
    // width: 70,
    // height: 70,
    // ...Platform.select({
    //   ios: {
    //     shadowColor: '#000',
    //     shadowOffset: {
    //       width: 0,
    //       height: 1,
    //     },
    //     shadowOpacity: 0.20,
    //     shadowRadius: 1.41,
    //   },
    //   android: {
    //     elevation: 2,
    //   },
    // }),
  },
  playCount: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '100%',
    fontSize: 12,
    paddingLeft: 3,
    paddingRight: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    color: '#fff',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
})
