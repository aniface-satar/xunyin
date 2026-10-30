/**
 * 自定义图片背景：多套图片 + 每套自己的剪裁与模糊度。
 *
 * 为什么图片列表不塞进 setting：`config/setting.ts` 的 mergeSetting 只认 string/boolean/number
 * 这类原始值，数组在启动合并那一步会被整条跳过 —— 存进去看着有、重启就没了。
 * 所以列表单独走 storage（AsyncStorage 分片），setting 里只留 enabled / applyToPlayer / activeId 这几个原语。
 *
 * 图片文件落在私有目录 `custom_bg/`：`<id>.jpg` 是剪裁后拿去铺底的那张，`<id>_src.jpg` 是原图，
 * 留着给「重新剪裁」用。删一套时两个一起删。
 */
import { useEffect, useMemo, useState } from 'react'
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { copyFile, existsFile, mkdir, privateStorageDirectoryPath, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { setCustomBgSource } from '@/utils/customBgBridge'
import { MAX_WALLPAPER_VEIL, WALLPAPER_INK, clampWallpaperVeil, isDarkWallpaperInk, normalizeWallpaperInk } from '@/utils/wallpaper/palette'
import settingState from '@/store/setting/state'
import { updateSetting } from '@/core/common'

export interface CustomBgCrop {
  /** 相对铺满尺寸的缩放倍数，1 = 刚好铺满 */
  zoom: number
  /** 旋转角度（度），-180 ~ 180 */
  rot: number
  /** 位移，按裁剪框宽高的比例记，换屏幕尺寸不会跑位 */
  x: number
  y: number
}

/**
 * 老存档条目的形状：v1.3 之前每张只有一支 veil（方向由当时的墨推）。
 * v1.3 起拆成 veilDark / veilLight 两层，读旧数据时按这个类型接，
 * 老字段只作为迁移种子读一次（见 loadCustomBg），落盘后就是新形状。
 */
interface LegacyCustomBgItem extends CustomBgItem {
  /** 旧版单一柔光深度（0 ~ 0.85） */
  veil?: number
}

export interface CustomBgItem {
  id: string
  name: string
  /** 剪裁后的图片绝对路径，铺底用这张 */
  file: string
  /** 用户选的原始图片绝对路径，重新剪裁用 */
  src: string
  crop: CustomBgCrop
  /** 模糊半径（px），运行时生效，不烘进图片里 */
  blur: number
  /**
   * 压暗层（深色柔光）深度（0 ~ 0.85），这一张自己的。
   * 以前柔光归全局一档、方向由墨色推；现在拆成两层、各归各的滑块，
   * 与墨色解绑（任何一个颜色都可以开两个方向的柔光）。
   *
   * 两层**同时生效、可以叠加**：一压一提的组合就是"雾面 / 胶片感"
   * （阴影被抬起、高光被压下），这是编辑器语义，不是失误 —— 见 utils/wallpaper/palette.ts。
   */
  veilDark: number
  /**
   * 提亮层（浅色柔光）深度（0 ~ 0.85），这一张自己的，与 veilDark 同上。
   */
  veilLight: number
  /**
   * 这一张自己的前景色（字 / 图标 / 分割线 / 按钮），存 `rgb(r, g, b)` 或色板里的 `#RRGGBB`。
   *
   * 以前它是全局一个（theme.customBg.ink，白/黑两选一），但"A 图是夜景、B 图是明信片"时
   * 全局那一支必然有一半是错的 —— 用户得切一次图改一次设置。所以下沉进条目：
   * 每张背景配自己的那一支，切图时整套颜色自己跟着换。
   */
  ink: string
}

export const CUSTOM_BG_DIR = `${privateStorageDirectoryPath}/custom_bg`
export const MAX_CUSTOM_BG = 8
export const DEFAULT_CUSTOM_BG_BLUR = 0
export const MAX_CUSTOM_BG_BLUR = 40
/** 新图默认只压一点暗（0.3）、不提亮，不喜欢再去滑块里调 —— 两条滑块各归各 */
export const DEFAULT_CUSTOM_BG_VEIL_DARK = 0.3
export const DEFAULT_CUSTOM_BG_VEIL_LIGHT = 0
export const MAX_CUSTOM_BG_VEIL = MAX_WALLPAPER_VEIL
/** 新图默认白字（与色板第一格一致）；添加时如果已有背景，会继承当前那张的墨色 */
export const DEFAULT_CUSTOM_BG_INK = WALLPAPER_INK

let items: CustomBgItem[] = []
let loaded = false
let loadTask: Promise<void> | null = null
const listeners = new Set<() => void>()

const emit = () => {
  listeners.forEach((fn) => { fn() })
}

export const subscribeCustomBg = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** RN 的 Image 只认带 scheme 的 uri，裸路径在安卓上会当成资源名去找 */
export const toImageUri = (path: string) => {
  if (!path) return path
  if (/^(file|content|http|https|data):/.test(path)) return path
  return `file://${path}`
}

/** 反过来的那一半：文件读写要的是裸路径，view-shot 有时会把 file:// 一起带回来 */
const toFsPath = (path: string) => {
  if (!path) return path
  if (!path.startsWith('file://')) return path
  const bare = path.slice(7)
  try {
    return decodeURIComponent(bare)
  } catch (err) {
    return bare
  }
}

export const getCustomBgItems = () => items

export const getActiveCustomBg = (): CustomBgItem | null => {
  const activeId = settingState.setting['theme.customBg.activeId']
  return items.find((item) => item.id === activeId) ?? items[0] ?? null
}

/**
 * 两层柔光深度落到 setting 上的那一份「镜像」。
 *
 * 真相是每一套背景自己的 `veilDark` / `veilLight`；setting 上这两份退化成"当前这套是多少"，
 * 只是为了让消费侧不必改：播控页那支是反编译代码，它同步读的只有 setting 这几个键，改不动；
 * PageContent / GlassBackdrop / LoadingMask 也都订阅这两个值。
 * 于是每次切换/增删/改图时顺手把它们对齐一次。
 */
const syncVeilSettings = (item: CustomBgItem) => {
  const veilDark = clampWallpaperVeil(item.veilDark)
  const veilLight = clampWallpaperVeil(item.veilLight)
  const patch: { 'theme.customBg.veilDark'?: number, 'theme.customBg.veilLight'?: number } = {}
  if (settingState.setting['theme.customBg.veilDark'] !== veilDark) patch['theme.customBg.veilDark'] = veilDark
  if (settingState.setting['theme.customBg.veilLight'] !== veilLight) patch['theme.customBg.veilLight'] = veilLight
  if (Object.keys(patch).length > 0) updateSetting(patch)
}

/** 把「当前这套 + 两个开关」同步到窄桥上，主题侧拼 bg-image 时同步读它 */
const syncBridge = () => {
  const item = getActiveCustomBg()
  if (!settingState.setting['theme.customBg.enabled'] || !item) {
    setCustomBgSource(null)
    return
  }
  setCustomBgSource({
    uri: toImageUri(item.file),
    blur: item.blur,
    applyToPlayer: settingState.setting['theme.customBg.applyToPlayer'],
    ink: item.ink,
  })
  syncVeilSettings(item)
  syncInkSetting(item.ink)
}

export const setCustomBgEnabled = (enabled: boolean) => {
  updateSetting({ 'theme.customBg.enabled': enabled })
  syncBridge()
  emit()
}

export const setCustomBgApplyToPlayer = (applyToPlayer: boolean) => {
  updateSetting({ 'theme.customBg.applyToPlayer': applyToPlayer })
  syncBridge()
  emit()
}

export const setActiveCustomBg = (id: string) => {
  updateSetting({ 'theme.customBg.activeId': id })
  syncBridge()
  emit()
}

/**
 * 墨色的「镜像」：真相在每张背景自己的 `ink`，setting 上这一份只是为了：
 *   1. 老存档升级时当一次性的种子（见 loadCustomBg）；
 *   2. 让 JS 侧调试 / 其它读 setting 的地方看到"当前这套是什么颜色"。
 *
 * 真正参与拼主题的是窄桥上的那份（syncBridge 同步写），不是它 —— 换色时先改条目、
 * 再 refreshTheme，别只写 setting，那样只会留下半套旧色。
 */
const syncInkSetting = (ink: string) => {
  const next = normalizeWallpaperInk(ink)
  if (settingState.setting['theme.customBg.ink'] === next) return
  updateSetting({ 'theme.customBg.ink': next })
}

const persist = async() => {
  syncBridge()
  emit()
  await saveData(storageDataPrefix.customBg, items)
}

const ensureDir = async() => {
  if (await existsFile(CUSTOM_BG_DIR)) return
  await mkdir(CUSTOM_BG_DIR)
}

/** 截图落在缓存目录，拷进私有目录之后就没用了 */
const discardTemp = (path: string) => {
  if (!path || path.startsWith(CUSTOM_BG_DIR)) return
  unlink(path).catch(() => { /* 缓存目录里的残留由系统自己回收 */ })
}

/** 编号只按现有的「背景N」往最大数上接，删掉中间一套不会让新的一套撞名 */
const nextSeq = () => items.reduce((max, item) => {
  const match = /^背景(\d+)$/.exec(item.name)
  return match ? Math.max(max, Number(match[1])) : max
}, 0) + 1

export const loadCustomBg = async() => {
  if (loaded) return
  // 启动时 initTheme 与设置页会同时问一次，这里把并发收成同一个任务
  loadTask ??= (async() => {
    const saved = await getData<LegacyCustomBgItem[]>(storageDataPrefix.customBg)
    // 柔光曾经是全局一档；老数据里没有条目自己的 veil，把它们统一继承当时的那档，观感不至于突变
    const legacyVeil = clampWallpaperVeil(settingState.setting['theme.customBg.veil'])
    // 墨色同理：老版本只有一个全局的 white/black，升级后每张各自持有一份 —— 先把老值当种子，
    // 用户之后在任一张的编辑页改色，只影响那一张
    const legacyInk = normalizeWallpaperInk(settingState.setting['theme.customBg.ink'])
    const alive: CustomBgItem[] = []
    let migrated = false
    for (const item of Array.isArray(saved) ? saved : []) {
      if (!item?.file || !item?.id) continue
      // 用户可能在文件管理器里把图删了，缺图的那套直接丢掉，别在列表里留个空壳
      if (!await existsFile(item.file)) continue
      const hasVeilPair = Number.isFinite(Number(item.veilDark)) && Number.isFinite(Number(item.veilLight))
      const hasInk = typeof item.ink === 'string' && item.ink.length > 0
      if (!hasVeilPair || !hasInk) migrated = true
      // 老条目只有一支 veil，方向由当时的墨推（浅墨压暗 / 深墨提亮）。拆成两层时
      // 按同一条规则把它放进对应的那支、另一支归零 —— 观感与升级前逐像素一致
      const legacySingle = Number.isFinite(Number(item.veil)) ? clampWallpaperVeil(item.veil) : legacyVeil
      const itemInk = hasInk ? normalizeWallpaperInk(item.ink) : legacyInk
      const inkIsDark = isDarkWallpaperInk(itemInk)
      alive.push({
        id: item.id,
        name: item.name || `背景${alive.length + 1}`,
        file: item.file,
        src: item.src || '',
        crop: {
          zoom: Number(item.crop?.zoom) || 1,
          rot: Number(item.crop?.rot) || 0,
          x: Number(item.crop?.x) || 0,
          y: Number(item.crop?.y) || 0,
        },
        blur: Math.min(MAX_CUSTOM_BG_BLUR, Math.max(0, Number(item.blur) || 0)),
        veilDark: hasVeilPair ? clampWallpaperVeil(item.veilDark) : (inkIsDark ? 0 : legacySingle),
        veilLight: hasVeilPair ? clampWallpaperVeil(item.veilLight) : (inkIsDark ? legacySingle : 0),
        ink: itemInk,
      })
    }
    items = alive
    loaded = true
    if (!items.some((item) => item.id === settingState.setting['theme.customBg.activeId'])) {
      updateSetting({ 'theme.customBg.activeId': items[0]?.id ?? '' })
    }
    syncBridge()
    emit()
    // 迁移过就落一次盘：下次启动不必再依赖那两个全局键（它们已经是"当前这套"的镜像了）
    if (migrated) await saveData(storageDataPrefix.customBg, items)
  })().catch((err) => {
    // 读失败不能让后续调用永远吊在这个 promise 上，当成"没有背景"继续跑
    console.log('load custom bg failed', err)
    loaded = true
    emit()
  })
  await loadTask
}

export const addCustomBg = async(capturedPath: string, src: string, crop: CustomBgCrop, blur: number, veilDark: number, veilLight: number, ink: string) => {
  await loadCustomBg()
  if (items.length >= MAX_CUSTOM_BG) throw new Error('custom_bg_limit')
  await ensureDir()
  const id = `bg_${Date.now()}`
  const file = `${CUSTOM_BG_DIR}/${id}.jpg`
  await copyFile(toFsPath(capturedPath), file)
  discardTemp(toFsPath(capturedPath))
  const item: CustomBgItem = {
    id,
    name: `背景${nextSeq()}`,
    file,
    src: await storeSource(src, id),
    crop,
    blur: Math.min(MAX_CUSTOM_BG_BLUR, Math.max(0, Math.round(blur))),
    veilDark: clampWallpaperVeil(veilDark),
    veilLight: clampWallpaperVeil(veilLight),
    ink: normalizeWallpaperInk(ink),
  }
  items = [...items, item]
  updateSetting({
    'theme.customBg.activeId': id,
    'theme.customBg.enabled': true,
  })
  await persist()
  return item
}

/** 重新剪裁：同一套直接换图，编号与名称都不动 */
export const replaceCustomBg = async(id: string, capturedPath: string, src: string, crop: CustomBgCrop, blur: number, veilDark: number, veilLight: number, ink: string) => {
  await loadCustomBg()
  const target = items.find((item) => item.id === id)
  if (!target) return null
  await ensureDir()
  const file = `${CUSTOM_BG_DIR}/${id}.jpg`
  await copyFile(toFsPath(capturedPath), file)
  discardTemp(toFsPath(capturedPath))
  const storedSrc = await storeSource(src, id)
  items = items.map((item) => item.id === id
    ? {
        ...item,
        file,
        src: storedSrc || item.src,
        crop,
        blur: Math.min(MAX_CUSTOM_BG_BLUR, Math.max(0, Math.round(blur))),
        veilDark: clampWallpaperVeil(veilDark),
        veilLight: clampWallpaperVeil(veilLight),
        ink: normalizeWallpaperInk(ink),
      }
    : item)
  await persist()
  return items.find((item) => item.id === id) ?? null
}

export const updateCustomBg = async(id: string, patch: Partial<CustomBgItem>) => {
  await loadCustomBg()
  items = items.map((item) => item.id === id ? { ...item, ...patch } : item)
  await persist()
}

export const removeCustomBg = async(id: string) => {
  await loadCustomBg()
  const target = items.find((item) => item.id === id)
  if (!target) return
  items = items.filter((item) => item.id !== id)
  if (settingState.setting['theme.customBg.activeId'] === id) {
    updateSetting({ 'theme.customBg.activeId': items[0]?.id ?? '' })
  }
  await persist()
  // 删文件放在持久化之后：哪怕这里失败，列表也已经干净了，不会留个点不开的空壳
  try {
    if (target.file) await unlink(target.file)
    if (target.src && target.src.startsWith(CUSTOM_BG_DIR)) await unlink(target.src)
  } catch (err) {
    console.log('remove custom bg file failed', err)
  }
}

export const pruneCustomBg = async(keepId: string) => {
  await loadCustomBg()
  for (const item of [...items]) {
    if (item.id === keepId) continue
    await removeCustomBg(item.id)
  }
}

/**
 * 把用户选的图收进临时目录，作为「原图」交给剪裁页。
 *
 * 系统选择器给的路径在临时目录/别的 app 沙箱里，重启后就不保证还在，所以先落一份自己的。
 * 落在临时目录而不是 custom_bg/：用户可能剪到一半就退出，那一份没有条目引用它，
 * 留在私有目录里就是永远清不掉的垃圾（临时目录由系统与启动清理负责）。
 */
export const importCustomBgSource = async(pickedPath: string) => {
  const target = `${temporaryDirectoryPath}/custom_bg_src_${Date.now()}.jpg`
  await copyFile(pickedPath, target)
  return target
}

/** 原图落到正式目录里，重新剪裁时才有得用 */
const storeSource = async(src: string, id: string) => {
  if (!src) return ''
  if (src.startsWith(CUSTOM_BG_DIR)) return src
  await ensureDir()
  const target = `${CUSTOM_BG_DIR}/${id}_src.jpg`
  await copyFile(src, target)
  discardTemp(src)
  return target
}

export const useCustomBgItems = () => {
  const [list, setList] = useState<CustomBgItem[]>(items)
  useEffect(() => {
    void loadCustomBg()
    const off = subscribeCustomBg(() => { setList(items) })
    // 订阅之前可能已经加载完并 emit 过，这里补一次
    if (loaded) setList(items)
    return off
  }, [])
  return list
}

export const useActiveCustomBg = () => {
  const list = useCustomBgItems()
  const activeId = settingState.setting['theme.customBg.activeId']
  const [currentId, setCurrentId] = useState(activeId)
  useEffect(() => {
    setCurrentId(settingState.setting['theme.customBg.activeId'])
    const handleUpdate = (keys: Array<keyof LX.AppSetting>) => {
      if (!keys.includes('theme.customBg.activeId')) return
      setCurrentId(settingState.setting['theme.customBg.activeId'])
    }
    global.state_event.on('configUpdated', handleUpdate)
    return () => {
      global.state_event.off('configUpdated', handleUpdate)
    }
  }, [])
  return useMemo(() => list.find((item) => item.id === currentId) ?? list[0] ?? null, [list, currentId])
}
