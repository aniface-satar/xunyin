import { useRef, useImperativeHandle, forwardRef, useState } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { View } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { setUserApiUpdateUrl } from '@/core/userApi'
import { hasBuiltinUpdateSource } from '@/config/builtinSources/catalog'
import type { UserApiUpdatePreview } from '@/core/userApiUpdate'
import {
  buildDowngradeConfirmMessage,
  runUpdateApply,
  runUpdatePreview,
  shouldSaveUpdateUrl,
  toastPreview,
  toastUpdateOutcome,
} from './updateOutcome'

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url)

export interface UpdateCheckModalType {
  show: (api: LX.UserApi.UserApiInfo) => void
}

export default forwardRef<UpdateCheckModalType, {}>((props, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const alertRef = useRef<ConfirmAlertType>(null)
  const inputRef = useRef<InputType>(null)
  const [visible, setVisible] = useState(false)
  const [api, setApi] = useState<LX.UserApi.UserApiInfo | null>(null)
  const [url, setUrl] = useState('')
  const [updating, setUpdating] = useState(false)

  const handleShow = () => {
    alertRef.current?.setVisible(true)
    requestAnimationFrame(() => {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 300)
    })
  }
  useImperativeHandle(ref, () => ({
    show(info) {
      // 先记下这个源再挂载弹窗：标题和输入框都要用它
      setApi(info)
      setUrl(info.updateUrl)
      setUpdating(false)
      if (visible) handleShow()
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow()
        })
      }
    },
  }))

  // 拿到预览之后怎么收尾：能更新的直接换，更旧的先问一句，其余按结论提示
  // saveUrl 不为空时，只有这个地址被证明是通的才落盘（见 shouldSaveUpdateUrl）
  const finishPreview = async(target: LX.UserApi.UserApiInfo, preview: UserApiUpdatePreview, saveUrl?: string) => {
    const builtin = target.builtin == 'local'
    if (preview.status == 'available') {
      if (saveUrl != null) await setUserApiUpdateUrl(target.id, saveUrl)
      const outcome = await runUpdateApply(target.id, preview)
      if (!toastUpdateOutcome(target.name, outcome, { builtin })) alertRef.current?.setVisible(false)
      return
    }
    if (preview.status == 'older') {
      // 手动更新是用户主动填的地址，但仍然要把降级说清楚：他可能只是从别处抄了个固定提交的链接
      const confirm = await confirmDialog({
        message: buildDowngradeConfirmMessage(preview),
        cancelButtonText: global.i18n.t('cancel_button_text_2'),
        confirmButtonText: global.i18n.t('confirm_button_text'),
        bgClose: false,
      })
      if (!confirm) return
      if (saveUrl != null) await setUserApiUpdateUrl(target.id, saveUrl)
      const outcome = await runUpdateApply(target.id, preview, { allowDowngrade: true })
      if (!toastUpdateOutcome(target.name, outcome, { builtin })) alertRef.current?.setVisible(false)
      return
    }
    // 地址真的通（已是最新 / 作者只给了版本页）才记住它；
    // 超时、填错源、语法坏都不写盘，否则以后每次启动都要重试这个坏地址
    if (saveUrl != null && shouldSaveUpdateUrl(preview)) await setUserApiUpdateUrl(target.id, saveUrl)
    if (!toastPreview(target.name, preview, { builtin })) alertRef.current?.setVisible(false)
  }

  const handleConfirm = async() => {
    if (!api || updating) return
    const input = url.trim()
    if (input && !isHttpUrl(input)) {
      toast(t('user_api_update_check_invalid_url_tip'), 'long')
      return
    }
    setUpdating(true)
    try {
      // 清空输入是明确的「不再用这个自定义地址」：先落盘再检查脚本自带的地址，
      // 不能因为检查失败又把清空回滚掉
      if (!input) {
        const hadUrl = !!api.updateUrl
        if (hadUrl) await setUserApiUpdateUrl(api.id, '')
        // 内置源的地址还可能来自脚本头部或目录，不能只看 api.scriptUpdateUrl
        if (!api.scriptUpdateUrl && !hasBuiltinUpdateSource(api.id)) {
          if (hadUrl) {
            toast(t('user_api_update_check_cleared_tip'), 'long')
            alertRef.current?.setVisible(false)
          } else {
            // 本来就没有地址可清：按正常检查给结论（内置源会说作者没提供公开地址）
            toastPreview(api.name, await runUpdatePreview(api.id), { builtin: api.builtin == 'local' })
          }
          return
        }
        await finishPreview(api, await runUpdatePreview(api.id))
        return
      }
      // 先测用户这次填的地址，测通了才保存：以前是先存再测，填错的地址会留在源里，
      // 后台每次启动都去试它（西瓜聚合源那条「名字对不上」就是这么来的）
      await finishPreview(api, await runUpdatePreview(api.id, input), input)
    } finally {
      setUpdating(false)
    }
  }

  return (
    visible && api
      ? <ConfirmAlert
          ref={alertRef}
          title={t('user_api_manual_update_title', { name: api.name })}
          onConfirm={handleConfirm}
          disabledConfirm={updating}
          confirmText={updating ? t('user_api_manual_update_loading') : t('user_api_manual_update_confirm')}
        >
          <View style={styles.content}>
            <Text style={styles.label}>{t('user_api_update_check_address')}</Text>
            <Input
              ref={inputRef}
              value={url}
              onChangeText={setUrl}
              placeholder={api.scriptUpdateUrl ? t('user_api_update_check_address_current', { url: api.scriptUpdateUrl }) : ''}
              style={{ ...styles.input, backgroundColor: theme['c-primary-input-background'] }}
            />
            <Text style={styles.tip} size={12} color={theme['c-font-label']}>{t('user_api_update_check_address_tip')}</Text>
          </View>
        </ConfirmAlert>
      : null
  )
})

const styles = createStyle({
  content: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
  label: {
    marginBottom: 5,
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 290,
    borderRadius: 4,
  },
  tip: {
    marginTop: 6,
    lineHeight: 18,
  },
})
