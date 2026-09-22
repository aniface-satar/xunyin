import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useState } from 'react'
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
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
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
}

export interface HeaderType {
  setInfo: (info: DetailInfo) => void
}
export interface DetailInfo {
  name: string
  desc: string
  playCount: string
  imgUrl?: string
}

export default forwardRef<HeaderType, HeaderProps>(({ componentId, embedded, onBack }: { componentId: string, embedded?: boolean, onBack?: () => void }, ref) => {
  const fullStatusBarHeight = useStatusbarHeight()
  const theme = useTheme()
  const t = useI18n()
  const shareType = useSettingValue('common.shareType')
  const info = useListInfo()
  const allList = useMyList()
  const [detailInfo, setDetailInfo] = useState<DetailInfo>({ name: '', desc: '', playCount: '', imgUrl: info.img })
  const statusBarHeight = embedded ? 0 : fullStatusBarHeight

  useImperativeHandle(ref, () => ({
    setInfo(info) {
      setDetailInfo(info)
    },
  }), [])

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
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.7}
          onPress={back}
        >
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={share}
            accessibilityRole="button"
            accessibilityLabel={t('share_songlist')}
          >
            <Icon name="share" size={19} color={theme['c-font']} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={collect}
            accessibilityRole="button"
            accessibilityLabel={t('collect_songlist')}
          >
            <LoveIcon filled={isLoved} size={19} color={theme['c-font']} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ ...styles.infoRow, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
        <Pic playCount={detailInfo.playCount} imgUrl={detailInfo.imgUrl} />
        <View style={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, paddingLeft: 5 }} nativeID={NAV_SHEAR_NATIVE_IDS.songlistDetail_title}>
          <Text size={14} numberOfLines={ 1 }>{detailInfo.name}</Text>
          <View style={{ flexGrow: 0, flexShrink: 1 }}>
            <Text size={13} color={theme['c-font-label']} numberOfLines={ 4 }>{detailInfo.desc}</Text>
          </View>
        </View>
      </View>
      <ActionBar />
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
