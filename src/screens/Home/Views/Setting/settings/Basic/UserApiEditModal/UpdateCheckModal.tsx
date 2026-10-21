import { useRef, useImperativeHandle, forwardRef, useState } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { View } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { setUserApiUpdateUrl } from '@/core/userApi'
import {
  buildDowngradeConfirmMessage,
  runUpdateApply,
  runUpdatePreview,
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

  const handleConfirm = async() => {
    if (!api || updating) return
    const input = url.trim()
    if (input && !isHttpUrl(input)) {
      toast(t('user_api_update_check_invalid_url_tip'), 'long')
      return
    }
    setUpdating(true)
    try {
      if (input != api.updateUrl) await setUserApiUpdateUrl(api.id, input)
      const preview = await runUpdatePreview(api.id)
      if (preview.status == 'available') {
        const outcome = await runUpdateApply(api.id, preview)
        if (!toastUpdateOutcome(api.name, outcome)) alertRef.current?.setVisible(false)
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
        const outcome = await runUpdateApply(api.id, preview, { allowDowngrade: true })
        if (!toastUpdateOutcome(api.name, outcome)) alertRef.current?.setVisible(false)
        return
      }
      if (!toastPreview(api.name, preview)) alertRef.current?.setVisible(false)
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
