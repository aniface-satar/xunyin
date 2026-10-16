import { useCallback, useRef, useState } from 'react'
import { Modal, TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import ShareCard, { type ShareCardData } from '@/components/ShareCard'
import { useI18n } from '@/lang'
import { useStatusbarHeight } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { cardFileName } from '@/utils/shareCard/cardFileName'
import { captureShareCard, shareCapturedCard } from '@/utils/shareCard/exportCard'
import { saveShareCard } from '@/utils/shareCard/saveCard'
import { createStyle, toast } from '@/utils/tools'
import { type LyricBlockLine } from './fitLyricBlock'

interface Props {
  visible: boolean
  mode: 'music' | 'lyric'
  musicInfo: ShareCardData
  lyricLines?: readonly LyricBlockLine[]
  onClose: () => void
}

export default ({ visible, mode, musicInfo, lyricLines, onClose }: Props) => {
  const t = useI18n()
  const { width, height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const shotRef = useRef<View>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleReady = useCallback((value: boolean) => { setReady(value) }, [])

  const shoot = async() => captureShareCard(shotRef, cardFileName(musicInfo.name, musicInfo.singer))

  const handleShare = async() => {
    setBusy(true)
    try {
      const { path } = await shoot()
      // 三个入参与 shareMusic（src/utils/tools.ts:349）逐位对齐：chooser 标题、EXTRA_SUBJECT、EXTRA_TEXT。
      // share_card_title_music 与 share_title_music 都是已有键，图片这条路不该另起一句文案。
      await shareCapturedCard(path,
        t('share_card_title_music', { name: musicInfo.name }),
        t('share_title_music'),
        `${musicInfo.name} - ${musicInfo.singer}`)
    } catch {
      toast(t('share_card_capture_failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async() => {
    setBusy(true)
    try {
      const { path } = await shoot()
      const name = await saveShareCard(path, cardFileName(musicInfo.name, musicInfo.singer))
      // null = 用户在文件夹选择器里取消了，那不叫失败，也不该说"已保存"
      if (name) toast(t('share_card_saved', { name }))
      else toast(t('share_card_save_canceled'))
    } catch {
      toast(t('share_card_save_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} onRequestClose={onClose} statusBarTranslucent animationType="fade">
      <View style={styles.root}>
        {/* 被拍的只有这一层：两枚按钮挂在它外面，所以不会进图（spec §5） */}
        <ShareCard
          ref={shotRef}
          mode={mode}
          musicInfo={musicInfo}
          lyricLines={lyricLines}
          width={width}
          height={height}
          onReadyChange={handleReady}
        />
        <View style={[styles.actions, { paddingTop: statusBarHeight + 6 }]}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleSave} disabled={busy || !ready} accessibilityRole="button" accessibilityLabel={t('share_card_save')}>
            <Icon name="download-2" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShare} disabled={busy || !ready} accessibilityRole="button" accessibilityLabel={t('share_title_music')}>
            <Icon name="share" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = createStyle({
  root: { flex: 1, backgroundColor: '#000' },
  actions: { position: 'absolute', top: 0, right: 0, flexDirection: 'row', paddingRight: 12 },
  actionBtn: {
    width: 44,
    height: 44,
    margin: 4,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
})
