/**
 * 编辑页预览里的「整页样张」：把「我的」这一页的界面画在背景图上。
 *
 * 为什么要有它：编辑页原来只预览"这张图长什么样"，但用户真正要判断的是"这套配色落在
 * 界面上还剩多少可读性" —— 字压在照片的哪块亮部、分割线还看不看得见、播控条和导航栏
 * 会不会糊成一片。光看图判断不了这些，所以这里按真机的版式铺一层假界面。
 *
 * 三条约束：
 *
 *   1. **纯装饰**：`pointerEvents="none"`，不接手势、不读任何真实数据（歌单是 8 条示例、
 *      歌曲固定「示例歌曲 / 示例歌手」），拖图/缩放的手势必须穿过它落到下面的裁剪框上。
 *   2. **不参与导出**：调用方在截图那一下把它摘掉（见 CustomBgCropper 的 `capturing`），
 *      否则这些字、这些框会被烘进壁纸图里。
 *   3. **只跟着"墨"走**：颜色全部由当前选中的那支前景色派生（wallpaperInkAlpha），
 *      不读主题 —— 用户还没点确认时，主题里还是上一套颜色，读主题就会"预览比手慢一步"。
 *
 * 尺寸按 375 宽的设计稿写（与全 App 的样式基准一致），外层整体缩放到预览框的实际大小，
 * 所以在任何屏幕上都保持真机的版式比例。
 */
import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { wallpaperInkAlpha } from '@/utils/wallpaper/palette'

/** 与 utils/pixelRatio 的设计基准同宽 */
const DESIGN_WIDTH = 375
/** 8 条示例歌单：正好把「我创建的歌单」那一块填满（用户要的"填满自建歌单区域"） */
const SAMPLE_PLAYLIST_COUNT = 8
const SAMPLE_PLAYLISTS = Array.from({ length: SAMPLE_PLAYLIST_COUNT }, (_, index) => `示例歌单 ${index + 1}`)
/** 与 config/constant.ts 的 NAV_MENUS 同序同图标；中间那项是「我的」，也就是这一页 */
const TABS = [
  { icon: 'leaderboard', label: '发现', active: false },
  { icon: 'love', label: '我的', active: true },
  { icon: 'search-2', label: '搜索', active: false },
] as const

interface Props {
  /** 预览框的实际宽高（dp） */
  width: number
  height: number
  /** 当前选中的前景色（任意 CSS 颜色） */
  ink: string
}

export default memo(({ width, height, ink }: Props) => {
  // 设计稿宽 → 实际宽 的缩放比；内层按设计稿写死数字，靠这一层整体缩到预览框大小
  const canvasWidth = scaleSizeW(DESIGN_WIDTH)
  const scale = canvasWidth ? width / canvasWidth : 0
  if (!scale || !height) return null
  // 缩放之后要铺满预览框，反推设计稿高度：这样"整页"在任何屏幕比例下都正好一屏
  const canvasHeight = height / scale
  const inkOf = (alpha: number) => wallpaperInkAlpha(ink, alpha)

  return (
    // 外层钉住预览框的尺寸并裁掉溢出，内层按设计稿尺寸画、整体缩放。
    // 内层不用 transformOrigin（0.73 还没有这个属性）：把它的布局中心对准预览框中心，
    // 围绕中心缩放之后正好铺满 —— 这个写法在有没有 transformOrigin 的版本上都成立。
    <View pointerEvents="none" style={[styles.root, { width, height }]}>
      <View
        style={[
          styles.canvas,
          {
            width: canvasWidth,
            height: canvasHeight,
            left: (width - canvasWidth) / 2,
            top: (height - canvasHeight) / 2,
            transform: [{ scale }],
          },
        ]}
      >
        {/* 状态栏：壁纸模式下它是透明的，图标由系统画 —— 这里只放一条时间，够撑起"整页"的感觉 */}
        <View style={styles.statusBar}>
          <Text size={12} color={inkOf(0.85)}>9:41</Text>
          <View style={styles.statusRight}>
            <View style={[styles.signalBar, styles.signalBarShort, { backgroundColor: inkOf(0.7) }]} />
            <View style={[styles.signalBar, styles.signalBarMid, { backgroundColor: inkOf(0.7) }]} />
            <View style={[styles.signalBar, styles.signalBarTall, { backgroundColor: inkOf(0.7) }]} />
            <View style={[styles.battery, { borderColor: inkOf(0.6) }]}>
              <View style={[styles.batteryFill, { backgroundColor: inkOf(0.7) }]} />
            </View>
          </View>
        </View>

        {/* 顶栏：左「我的」，右两个入口（下载 / 设置），与 Home/Vertical/Header 一致 */}
        <View style={styles.header}>
          <Text size={18} color={inkOf(1)}>我的</Text>
          <View style={styles.headerActions}>
            <Icon name="download-2" size={18} color={inkOf(0.88)} />
            <Icon name="setting" size={18} color={inkOf(0.88)} style={styles.headerIconRight} />
          </View>
        </View>

        <View style={styles.body}>
          {/* 快捷入口：我的收藏 / 历史播放 */}
          <View style={styles.quickRow}>
            <View style={[styles.quickTile, { backgroundColor: inkOf(0.10) }]}>
              <Icon name="love" size={22} color={inkOf(0.88)} />
              <Text size={14} color={inkOf(1)} style={styles.quickLabel}>我的收藏</Text>
            </View>
            <View style={[styles.quickTile, { backgroundColor: inkOf(0.10) }]}>
              <Icon name="music_time" size={22} color={inkOf(0.88)} />
              <Text size={14} color={inkOf(1)} style={styles.quickLabel}>历史播放</Text>
            </View>
          </View>

          {/* 自建歌单：标题 + 右侧操作，下面 8 条示例把它填满 */}
          <View style={styles.sectionHeader}>
            <Text size={13} color={inkOf(0.62)} style={styles.sectionLabel}>我创建的歌单</Text>
            <Text size={13} color={inkOf(1)}>新建歌单</Text>
          </View>

          <View style={styles.list}>
            {
              SAMPLE_PLAYLISTS.map((name) => (
                <View key={name} style={[styles.row, { borderBottomColor: inkOf(0.10) }]}>
                  <View style={[styles.cover, { backgroundColor: inkOf(0.08) }]}>
                    <View style={[styles.coverDisc, { borderColor: inkOf(0.30) }]} />
                    <View style={[styles.coverHole, { backgroundColor: inkOf(0.34) }]} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text size={15} color={inkOf(1)} numberOfLines={1}>{name}</Text>
                    <Text size={12} color={inkOf(0.62)} style={styles.rowCount} numberOfLines={1}>0 首</Text>
                  </View>
                  <Icon name="dots-vertical" size={16} color={inkOf(0.55)} />
                </View>
              ))
            }
          </View>
        </View>

        {/* 播控条：没有在播的歌 —— 封面用 App 自己的默认封面（Image 的空图占位），
            歌名 / 歌手写示例文案，右侧是上一首 / 播放 / 下一首 */}
        <View style={[styles.playerBar, { borderTopColor: inkOf(0.10) }]}>
          <Image url={null} style={styles.playerCover} />
          <View style={styles.playerInfo}>
            <Text size={15} color={inkOf(1)} numberOfLines={1}>示例歌曲</Text>
            <Text size={12} color={inkOf(0.62)} style={styles.playerArtist} numberOfLines={1}>示例歌手</Text>
          </View>
          <View style={styles.playerControls}>
            <Icon name="prevMusic" size={22} color={inkOf(0.88)} />
            <Icon name="play" size={26} color={inkOf(1)} style={styles.playerPlay} />
            <Icon name="nextMusic" size={22} color={inkOf(0.88)} />
          </View>
        </View>

        {/* 底部导航栏：发现 / 我的 / 搜索，当前停在「我的」 */}
        <View style={[styles.tabBar, { borderTopColor: inkOf(0.10) }]}>
          {
            TABS.map((tab) => (
              <View key={tab.label} style={styles.tabItem}>
                <Icon name={tab.icon} size={22} color={inkOf(tab.active ? 1 : 0.48)} />
                <Text size={11} color={inkOf(tab.active ? 1 : 0.48)} style={styles.tabLabel}>{tab.label}</Text>
              </View>
            ))
          }
        </View>
      </View>
    </View>
  )
})

const styles = createStyle({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
  },
  statusBar: {
    height: 28,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  signalBar: {
    width: 3,
    borderRadius: 1,
    marginRight: 3,
  },
  signalBarShort: { height: 5 },
  signalBarMid: { height: 8 },
  signalBarTall: { height: 11 },
  battery: {
    width: 20,
    height: 10,
    borderWidth: 1,
    borderRadius: 3,
    padding: 1,
    marginLeft: 3,
    justifyContent: 'center',
  },
  batteryFill: {
    width: '70%',
    height: '100%',
    borderRadius: 1,
  },
  header: {
    height: 46,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconRight: {
    marginLeft: 18,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    marginBottom: 12,
  },
  quickTile: {
    flex: 1,
    height: 64,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    marginTop: 6,
  },
  sectionHeader: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionLabel: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  row: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  // 歌单占位封面：一枚唱片（一圈纹路 + 中心孔），不加载任何图片
  coverDisc: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  coverHole: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  rowCount: {
    marginTop: 2,
  },
  playerBar: {
    height: 60,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  playerCover: {
    width: 44,
    height: 44,
    borderRadius: 4,
    overflow: 'hidden',
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  playerArtist: {
    marginTop: 2,
  },
  playerControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerPlay: {
    marginHorizontal: 14,
  },
  tabBar: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    marginTop: 3,
  },
})
