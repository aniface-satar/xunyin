import { TouchableOpacity, View } from 'react-native'

import { BorderWidths } from '@/theme'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useStatusbarHeight } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'
import { Icon } from '@/components/common/Icon'
import { LoveIcon } from '@/components/common/LoveIcon'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { type ArtistDetail } from '@/utils/musicSdk/artistNormalizers'

const IMAGE_WIDTH = scaleSizeW(70)

type HeaderInfo = Pick<ArtistDetail, 'name' | 'alias' | 'img' | 'songCount' | 'albumCount'>

export default ({ info, liked, onToggleLike, onBack }: {
  info: HeaderInfo
  liked: boolean
  onToggleLike: () => void
  onBack?: () => void
}) => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()
  const t = useI18n()

  const counts = [
    info.songCount ? t('artist_song_count', { num: info.songCount }) : '',
    info.albumCount ? t('artist_album_count', { num: info.albumCount }) : '',
  ].filter(Boolean).join(' · ')

  return (
    <View style={{ ...styles.container, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={global.i18n.t('back')}
          activeOpacity={0.7}
          onPress={onBack}
        >
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
      </View>
      <View style={styles.infoRow}>
        <Image url={info.img} style={{ width: IMAGE_WIDTH, height: IMAGE_WIDTH, borderRadius: IMAGE_WIDTH / 2 }} />
        <View style={styles.infoText}>
          <Text size={16} numberOfLines={1}>{info.name}</Text>
          {info.alias
            ? <Text size={12} color={theme['c-font-label']} numberOfLines={1}>{info.alias}</Text>
            : null}
          {counts
            ? <Text style={styles.counts} size={11} color={theme['c-font-label']} numberOfLines={1}>{counts}</Text>
            : null}
        </View>
        <TouchableOpacity
          style={styles.likeBtn}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={t(liked ? 'love_remove' : 'love_add')}
          activeOpacity={0.7}
          onPress={onToggleLike}
        >
          <LoveIcon filled={liked} size={20} color={theme['c-font']} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flexDirection: 'column',
    borderBottomWidth: BorderWidths.normal,
  },
  topRow: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 38,
    height: 28,
    marginLeft: 10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  likeBtn: {
    width: 40,
    height: 40,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    paddingBottom: 10,
  },
  infoText: {
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 12,
  },
  counts: {
    marginTop: 4,
  },
})
