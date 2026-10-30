import { memo, useCallback, useRef, useState } from 'react'
import { Image, TouchableOpacity, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { refreshTheme } from '@/core/theme'
import {
  addCustomBg,
  importCustomBgSource,
  MAX_CUSTOM_BG,
  removeCustomBg,
  replaceCustomBg,
  setActiveCustomBg,
  toImageUri,
  useCustomBgItems,
} from '@/core/customBg'
import type { CustomBgCrop } from '@/core/customBg'
import CustomBgCropper, { type CropResult } from './CustomBgCropper'

interface CropTarget {
  /** 有 id 表示在给已有那套重新剪裁 */
  id?: string
  src: string
  crop?: CustomBgCrop | null
  blur?: number
  veilDark?: number
  veilLight?: number
  ink?: string
}

/**
 * 自定义图片背景的子面板：只回答"有哪些图、每一套长什么样"。
 *
 * 它不再自带「自定义图片背景」那个开关，也不再管"要不要铺到播控页" ——
 * 前者归「应用主题」的两个勾选项，后者归「播控页背景」三选一（见 core/playerBg.ts）。
 *
 * 「柔光」「背景模糊」「界面颜色」都不在这里：它们跟"这一张图长什么样"绑死，
 * 已经下沉到裁剪页（CustomBgCropper）里，跟缩放、旋转排在一起，每张图各存一份。
 *
 * 界面颜色（墨）之所以也跟着下沉：一张夜景配白字、一张明信片配近黑，是同一批背景里的常态；
 * 放在这一级就只能整套共用一支，切一次图要去改一次设置 —— 那不是"主题"，是折腾。
 * 这一页只负责"有哪些图、哪张在用、每张是什么颜色"（列表里那一小圆点就是它的墨色）。
 */
export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const activeId = useSettingValue('theme.customBg.activeId')
  const items = useCustomBgItems()
  const choosePathRef = useRef<ChoosePathType>(null)
  const [target, setTarget] = useState<CropTarget | null>(null)

  const activeItem = items.find((item) => item.id === activeId) ?? items[0] ?? null

  const handlePick = useCallback((path: string) => {
    void importCustomBgSource(path).then((src) => {
      // 新图沿用当前那张的墨色：同一批壁纸通常是同一个观感偏好，省得每张都重挑一次
      setTarget({ src, ink: activeItem?.ink })
    }).catch((err) => {
      console.log('import custom bg failed', err)
      toast(t('setting_basic_theme_custom_bg_read_failed'))
    })
  }, [activeItem?.ink, t])

  const handleAdd = useCallback(() => {
    if (items.length >= MAX_CUSTOM_BG) {
      toast(t('setting_basic_theme_custom_bg_limit', { num: MAX_CUSTOM_BG }))
      return
    }
    choosePathRef.current?.show({
      title: t('setting_basic_theme_custom_bg_pick'),
      filter: ['jpg', 'jpeg', 'png', 'webp'],
    })
  }, [items.length, t])

  const handleRecrop = useCallback((id: string) => {
    const item = items.find((row) => row.id === id)
    if (!item) return
    setTarget({ id, src: item.src || item.file, crop: item.crop, blur: item.blur, veilDark: item.veilDark, veilLight: item.veilLight, ink: item.ink })
  }, [items])

  const handleRemove = useCallback((id: string, name: string) => {
    void confirmDialog({
      message: t('setting_basic_theme_custom_bg_delete_tip', { name }),
      confirmButtonText: t('delete'),
      cancelButtonText: t('cancel'),
    }).then((confirm) => {
      if (!confirm) return
      void removeCustomBg(id).then(async() => { await refreshTheme() })
    })
  }, [t])

  const handleCropCancel = useCallback(() => { setTarget(null) }, [])

  const handleCropApply = useCallback((result: CropResult) => {
    const current = target
    if (!current) return
    const task = current.id
      ? replaceCustomBg(current.id, result.path, current.src, result.crop, result.blur, result.veilDark, result.veilLight, result.ink)
      : addCustomBg(result.path, current.src, result.crop, result.blur, result.veilDark, result.veilLight, result.ink)
    void task.then(async() => {
      setTarget(null)
      await refreshTheme()
      toast(t('setting_basic_theme_custom_bg_applied'))
    }).catch((err) => {
      console.log('save custom bg failed', err)
      setTarget(null)
      toast(String(err?.message) === 'custom_bg_limit'
        ? t('setting_basic_theme_custom_bg_limit', { num: MAX_CUSTOM_BG })
        : t('setting_basic_theme_custom_bg_apply_failed'))
    })
  }, [target, t])

  return (
    <>
      <SubTitle level={2} title={t('setting_basic_theme_custom_bg_saved')}>
        <View style={styles.list}>
          {
            items.map((item) => {
              const isActive = activeItem?.id === item.id
              return (
                <View key={item.id} style={[styles.item, isActive ? { borderColor: theme['c-primary-alpha-500'] } : null]}>
                  <TouchableOpacity style={styles.itemMain} activeOpacity={0.7} onPress={() => {
                    setActiveCustomBg(item.id)
                    // 播控页那一支要从主题里取图，换的这套得重新拼一次主题才生效
                    void refreshTheme()
                  }}>
                    <Image source={{ uri: toImageUri(item.file) }} style={styles.thumb} resizeMode="cover" />
                    <View style={styles.itemText}>
                      <View style={styles.itemNameRow}>
                        {/* 这一小格就是这张背景自己的前景色，一眼能看出"这图配的是黑字还是白字" */}
                        <View style={[styles.itemInkDot, { backgroundColor: item.ink }]} />
                        <Text size={13} numberOfLines={1} color={isActive ? theme['c-primary-font'] : theme['c-font']}>{item.name}</Text>
                      </View>
                      <Text size={11} numberOfLines={1} style={styles.itemSub} color={theme['c-450']}>
                        {`${t('setting_basic_theme_custom_bg_blur_value', { num: item.blur })} · ${t('setting_basic_theme_custom_bg_sub_veil_dark')} ${Math.round(item.veilDark * 100)}% / ${t('setting_basic_theme_custom_bg_sub_veil_light')} ${Math.round(item.veilLight * 100)}%`}
                      </Text>
                    </View>
                    {isActive ? <Text size={11} color={theme['c-primary-font']}>{t('setting_basic_theme_custom_bg_in_use')}</Text> : null}
                  </TouchableOpacity>
                  <View style={styles.itemActions}>
                    <TouchableOpacity style={styles.actionBtn} activeOpacity={0.6} onPress={() => { handleRecrop(item.id) }}>
                      <Text size={11} color={theme['c-450']}>{t('setting_basic_theme_custom_bg_recrop')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} activeOpacity={0.6} onPress={() => { handleRemove(item.id, item.name) }}>
                      <Text size={11} color={theme['c-primary']}>{t('delete')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })
          }
          <TouchableOpacity style={styles.addBtn} activeOpacity={0.7} onPress={handleAdd}>
            <Text size={13} color={theme['c-primary-font']}>＋ {t('setting_basic_theme_custom_bg_add')}</Text>
          </TouchableOpacity>
        </View>
      </SubTitle>

      <ChoosePath ref={choosePathRef} onConfirm={handlePick} />
      <CustomBgCropper
        visible={target != null}
        source={target?.src ?? ''}
        initialCrop={target?.crop ?? null}
        initialBlur={target?.blur}
        initialVeilDark={target?.veilDark}
        initialVeilLight={target?.veilLight}
        initialInk={target?.ink}
        onCancel={handleCropCancel}
        onApply={handleCropApply}
      />
    </>
  )
})

const styles = createStyle({
  list: {
    paddingRight: 25,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 方形小色块（和编辑页那盘色板同一个形状），后面跟着名字
  itemInkDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    marginRight: 6,
    // 白色与近白色压在浅色列表底上会化掉，给一圈极淡的描边把轮廓钉住
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.45)',
  },
  item: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.18)',
    borderRadius: 10,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumb: {
    width: scaleSizeW(64),
    height: scaleSizeH(44),
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
  },
  itemSub: {
    marginTop: 3,
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  actionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
})
