import { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Modal, TouchableOpacity, View } from 'react-native'

import Button from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import Loading from '@/components/common/Loading'
import Text from '@/components/common/Text'
import SheetThemeProvider from '@/components/player/SheetThemeProvider'
import ShareCard, { type ShareCardData } from '@/components/ShareCard'
import { RATIO_OPTIONS, type RatioKey, shotRect as shotRectFor } from './cardScale'
import { useI18n } from '@/lang'
import { useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { BorderRadius } from '@/theme'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { useWindowSize } from '@/utils/hooks'
import { cardFileName } from '@/utils/shareCard/cardFileName'
import { captureShareCard, shareCapturedCard } from '@/utils/shareCard/exportCard'
import { saveShareCard } from '@/utils/shareCard/saveCard'
import { createStyle, toast } from '@/utils/tools'
import { type LyricBlockLine } from './fitLyricBlock'

export interface ShareCardModalProps {
  visible: boolean
  mode: 'music' | 'lyric'
  musicInfo: ShareCardData
  /** 歌词卡正文字号(dp)。给值 = 用户在歌词大小设置里选的字号 ÷10；歌词模式专属，不给退回自适应档 */
  lyricFontSize?: number
  lyricLines?: readonly LyricBlockLine[]
  onClose: () => void
}

// 控件层的几何常数：底部动作行 = 全局「歌词工具条」那一套（flex:1 双钮、gap 12、左右 20、底 15）的同一坐标系。
const ACTION_HEIGHT = 44
const BAR_PADDING_BOTTOM = 15
// 进场：Modal 自己的 fade 先走一步，控件层随后淡入 + 上浮 12dp。只动控件层，
// 一帧都不碰被拍的 ShareCard —— 进场动效若落在被拍视图上，半透明的中间帧会烘进成品图。
const ENTER_DELAY = 90
const ENTER_DURATION = 260
const ENTER_RISE = 12
const NOTICE_DURATION = 200
// 冷像素缓存下"卡封面 / 整屏糊底"两路能差到几秒；热缓存几百毫秒就绪时不闪这行字，
// 所以先等 600ms 再出现（§11.4 第 20 条那个"空卡窗口"至少有一句话解释）。
const NOTICE_DELAY = 600

// 比例选择（RATIO_OPTIONS / shotRect 都在 cardScale.ts）：被拍矩形的宽恒等于屏幕宽，
// 换比例只换长度（h = w × 高/宽），'fullscreen' 档就是整屏。
// 卡片不按矩形重排：全屏档那张是"基准整体"，其余比例把这一个整体等比缩进矩形并居中
// （缩放因子在 ShareCard 里算，同样在 cardScale.ts），所以卡内内容的大小比例各档一致。
const DEFAULT_RATIO: RatioKey = 'fullscreen'
// 比例行与提示语布局
const RATIO_HEIGHT = 32
const RATIO_GAP = 8

type BusyAction = 'save' | 'share'

const ShareCardModal = ({ visible, mode, musicInfo, lyricFontSize, lyricLines, onClose }: ShareCardModalProps) => {
  const t = useI18n()
  const theme = useTheme()
  const glassColors = useGlassColors()
  const { width, height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const shotRef = useRef<View>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [slowNotice, setSlowNotice] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  const chrome = useRef(new Animated.Value(0)).current
  const noticeAnim = useRef(new Animated.Value(0)).current
  const [ratio, setRatio] = useState<RatioKey>(DEFAULT_RATIO)

  // 就绪只有这一个布尔：卡封面、整屏糊底两路各自落在 ShareCard 那一层，由它聚合成一次上报。
  // 这一层不另存自己的 ready —— 各存一份就会有人漏掉某一路（漏掉配色就是白封面拍成黑卡）。
  const handleReady = useCallback((value: boolean) => { setReady(value) }, [])

  // 系统"减少动画"开着时，进场与状态过渡全部直接落位。
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (alive) setReduceMotion(value) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      chrome.setValue(1)
      return
    }
    const anim = Animated.timing(chrome, {
      toValue: 1,
      duration: ENTER_DURATION,
      delay: ENTER_DELAY,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => { anim.stop() }
  }, [chrome, reduceMotion])

  useEffect(() => {
    const id = setTimeout(() => { setSlowNotice(true) }, NOTICE_DELAY)
    return () => { clearTimeout(id) }
  }, [])

  const noticeVisible = slowNotice && !ready
  useEffect(() => {
    const anim = Animated.timing(noticeAnim, {
      toValue: noticeVisible ? 1 : 0,
      duration: reduceMotion ? 0 : NOTICE_DURATION,
      useNativeDriver: true,
    })
    anim.start()
    return () => { anim.stop() }
  }, [noticeAnim, noticeVisible, reduceMotion])

  const shoot = async() => captureShareCard(shotRef, cardFileName(musicInfo.name, musicInfo.singer))

  const handleShare = async() => {
    setBusy('share')
    try {
      const { path } = await shoot()
      // 三个入参与 shareMusic（src/utils/tools.ts:349）逐位对齐：chooser 标题、EXTRA_SUBJECT、EXTRA_TEXT。
      // share_card_title_music 与 share_title_music 都是已有键，图片这条路不该另起一句文案。
      await shareCapturedCard(path,
        t('share_card_title_music', { name: musicInfo.name }),
        t('share_title_music'),
        `${musicInfo.name} - ${musicInfo.singer}`)
    } catch (e) {
      console.error('[share_card] capture_failed', e)
      toast(t('share_card_capture_failed'))
    } finally {
      setBusy(null)
    }
  }

  const handleSave = async() => {
    setBusy('save')
    try {
      const { path } = await shoot()
      const name = await saveShareCard(path, cardFileName(musicInfo.name, musicInfo.singer))
      // null = 用户在文件夹选择器里取消了，那不叫失败，也不该说"已保存"
      if (name) toast(t('share_card_saved', { name }))
      else toast(t('share_card_save_canceled'))
    } catch (e) {
      console.error('[share_card] save_failed', e)
      toast(t('share_card_save_failed'))
    } finally {
      setBusy(null)
    }
  }

  // 拍摄/落盘进行中不接受关闭：这一刻吐掉 Modal 会让 captureRef 的 promise reject，
  // 在身后那层屏幕上弹一句"生成图片失败"（spec §11.6 记的旧账）。两枚动作都在转圈，短暂关不上是可读的。
  const handleClose = () => {
    if (busy != null) return
    onClose()
  }

  const chromeStyle = {
    opacity: chrome,
    transform: [{ translateY: chrome.interpolate({ inputRange: [0, 1], outputRange: [ENTER_RISE, 0] }) }],
  }

  // 被拍矩形：宽恒等于屏幕宽，比例只改长度（2:3 → 360×540，全屏 → 360×800）。
  // 长度超过屏幕的那些档（9:16、5:7 之类）会从屏幕下缘伸出去，被比例行/动作行盖住一截 ——
  // 那只是预览层的观感，导出图不受影响：captureRef 拍的是 ShareCard 那一层自己，按矩形宽高出图。
  // 糊底 ImageBackground 是 cover 缩放，跟着矩形重排，同一封面 uri 没有重载，
  // 所以切比例是纯布局路径，即时生效，不碰任何异步信号。
  const shotRect = shotRectFor(ratio, width, height)

  return (
    <Modal visible={visible} onRequestClose={handleClose} statusBarTranslucent animationType="fade">
      <View style={styles.root}>
        {/* 被拍的只有这一层：控件层挂在它外面，所以不会进图（spec §5）。
            非全屏比例下矩形比屏幕小，挂一层居中包装让它悬在屏幕正中。 */}
        <View style={styles.shotWrap}>
          {/* 被拍这一层必须读**应用**主题：卡色的判据就是"浅色模式白卡 / 深色模式黑卡"（cardTheme.ts）。
              分享卡是从播放页里开出来的，而 PlayDetail 那棵竖屏子树挂着 OnCoverThemeProvider，
              它会把 isDark 硬翻成 true（src/utils/monet/onCoverTheme.ts:236，那是给状态栏图标用的），
              不挂回来就是"应用浅色也给你黑卡"（2026-10-17 真机）。SheetThemeProvider 订阅 themeUpdated
              把用户那份主题重新发下来，context 穿得过 Modal —— 同一类弹层早就用过这条路。
              只包被拍的卡：下面那排按钮与提示语是界面 chrome，继续吃场上主题。 */}
          <SheetThemeProvider>
            <ShareCard
              ref={shotRef}
              mode={mode}
              musicInfo={musicInfo}
              lyricFontSize={lyricFontSize}
              lyricLines={lyricLines}
              width={shotRect.width}
              height={shotRect.height}
              masterWidth={width}
              masterHeight={height}
              onReadyChange={handleReady}
            />
          </SheetThemeProvider>
        </View>
        {/* 关闭：头部控件走播放页头部那一套（裸图标 + glassColors，无底色），位置跟随"收起/返回在左"的约定 */}
        <Animated.View style={[styles.closeLayer, { paddingTop: statusBarHeight + 6 }, chromeStyle]}>
          <TouchableOpacity
            style={[styles.closeBtn, busy != null && styles.dimmed]}
            onPress={handleClose}
            disabled={busy != null}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
          >
            <Icon name="close" size={20} color={glassColors.text} />
          </TouchableOpacity>
        </Animated.View>
        {/* 两枚动作：全局填充按钮（common/Button + c-button-background/c-button-font），
            形状与「歌词工具条」的复制/海报同源；禁用态就是全局的 0.3 透明度（Button 自带），
            进行中的那枚换成 common/Loading 转圈并压过禁用透明度。
            上面那排是比例选择（2:3 / 3:4 / 9:16 / 全屏），形状与歌词工具条的多选小按钮同族。 */}
        <Animated.View style={[styles.actions, chromeStyle]}>
          <Animated.View style={[styles.noticeLayer, { opacity: noticeAnim }]} pointerEvents="none">
            <Text size={12} color={glassColors.muted}>{t('share_card_creating')}</Text>
          </Animated.View>
          <View style={styles.ratioRow}>
            {
              RATIO_OPTIONS.map(({ key }) => {
                const selected = ratio === key
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.ratioBtn, selected ? { backgroundColor: theme['c-primary-background'] } : { backgroundColor: theme['c-button-background'] }]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={key === 'fullscreen' ? t('share_card_ratio_fullscreen') : key}
                    onPress={() => { setRatio(key) }}
                  >
                    <Text size={12} color={selected ? theme['c-primary-font'] : theme['c-button-font']}>
                      {key === 'fullscreen' ? t('share_card_ratio_fullscreen') : key}
                    </Text>
                  </TouchableOpacity>
                )
              })
            }
          </View>
          <View style={styles.actionsRow}>
            <Button
              style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }, busy === 'save' && styles.busyBtn]}
              disabled={busy != null || !ready}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel={t('share_card_save')}
            >
              {busy === 'save'
                ? <Loading size={14} color={theme['c-button-font']} />
                : <Text size={14} color={theme['c-button-font']}>{t('share_card_save')}</Text>}
            </Button>
            <Button
              style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }, busy === 'share' && styles.busyBtn]}
              disabled={busy != null || !ready}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel={t('share_card_share')}
            >
              {busy === 'share'
                ? <Loading size={14} color={theme['c-button-font']} />
                : <Text size={14} color={theme['c-button-font']}>{t('share_card_share')}</Text>}
            </Button>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

// 这一层与全局按钮同一套坐标：**走 createStyle**（随 App 字号设置缩放，和全站按钮行为一致），
// 颜色全部吃主题（动作 = c-button-background/c-button-font，头部与提示语 = glassColors，选中比例 =
// c-primary-background/c-primary-font）。
// 与 §11.12 第一版"原始 dp + 中性深玻璃"的取舍相反 —— 用户要求按钮与全局统一，全局就是这一套；
// 被拍层（ShareCard/两张卡）不受影响，那里仍是原始 dp + 固定色（它是产物图，不跟 UI 设置走）。
const styles = createStyle({
  root: { flex: 1, backgroundColor: '#000' },
  // 比例选择把被拍矩形改小时，矩形悬在屏幕正中而不是左上角（全屏档宽高恰好铺满，包装层无感）
  shotWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  closeLayer: { position: 'absolute', top: 0, left: 0 },
  closeBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.3 },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
    gap: RATIO_GAP,
    paddingHorizontal: 20,
    paddingBottom: BAR_PADDING_BOTTOM,
  },
  // 状态条绝对定位在比例行上方：它出现/消失不带动下面的按钮布局（热缓存下这里永远不出现）
  noticeLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BAR_PADDING_BOTTOM + ACTION_HEIGHT + RATIO_HEIGHT + RATIO_GAP * 2,
    alignItems: 'center',
  },
  ratioRow: {
    flexDirection: 'row',
    gap: RATIO_GAP,
  },
  ratioBtn: {
    flex: 1,
    height: RATIO_HEIGHT,
    borderRadius: BorderRadius.normal,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    height: ACTION_HEIGHT,
    borderRadius: BorderRadius.normal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 压过 Button 的 disabled 0.3：进行中的那一枚要看清转圈（另一枚保持全局禁用态）
  busyBtn: { opacity: 1 },
})

export default ShareCardModal
