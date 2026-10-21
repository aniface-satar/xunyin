import { useCallback, useMemo, useRef, useState } from 'react'
import Text from '@/components/common/Text'
import { View, TouchableOpacity, ScrollView } from 'react-native'
import { confirmDialog, createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useUserApiList, useStatus, state as userApiState } from '@/store/userApi'
import { useSettingValue } from '@/store/setting/hook'
import { removeUserApi } from '@/core/userApi'
import { BorderRadius } from '@/theme'
import CheckBox from '@/components/common/CheckBox'
import { Icon } from '@/components/common/Icon'
import Loading from '@/components/common/Loading'
import settingState from '@/store/setting/state'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'
import { pickBuiltinSources } from '@/utils/builtinSources'
import { setApiSource } from '@/core/apiSource'
import UpdateCheckModal, { type UpdateCheckModalType } from './UpdateCheckModal'
import {
  buildPreviewConfirmMessage,
  runUpdateApply,
  runUpdatePreview,
  toastPreview,
  toastUpdateOutcome,
} from './updateOutcome'

const formatVersionName = (version: string) => {
  return /^\d/.test(version) ? `v${version}` : version
}
const ListItem = ({ item, activeId, checking, busy, onSelect, onRemove, onCheckUpdate, onManualUpdate }: {
  item: LX.UserApi.UserApiInfo
  activeId: string
  checking: boolean
  busy: boolean
  onSelect: (id: string) => void
  onRemove: (id: string, name: string) => void
  onCheckUpdate: (item: LX.UserApi.UserApiInfo) => void
  onManualUpdate: (item: LX.UserApi.UserApiInfo) => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const apiStatus = useStatus()
  // 状态只说明「现在正在用的这个源」起没起来，所以只显示在被勾选的那一行
  const statusLabel = activeId == item.id
    ? `[${apiStatus.status
      ? t('setting_basic_source_status_success')
      : apiStatus.message == 'initing'
        ? t('setting_basic_source_status_initing')
        : t('setting_basic_source_status_failed')}]`
    : ''
  const handleSelect = () => {
    onSelect(item.id)
  }
  const handleRemove = () => {
    onRemove(item.id, item.name)
  }
  const handleCheckUpdate = () => {
    onCheckUpdate(item)
  }
  const handleManualUpdate = () => {
    onManualUpdate(item)
  }

  return (
    <View style={{ ...styles.listItem, backgroundColor: activeId == item.id ? theme['c-primary-background-active'] : 'transparent' }}>
      <View style={styles.listItemLeft}>
        <CheckBox check={activeId == item.id} onChange={handleSelect} need disabled={busy} size={0.86} align="start">
          <View style={styles.nameBlock}>
            <Text size={17} style={styles.itemName}>
              {item.name}
              {
                item.version ? (
                  <Text size={12} style={styles.itemMeta} color={theme['c-font-label']}>{ '   ' + formatVersionName(item.version) }</Text>
                ) : null
              }
              {
                item.author ? (
                  <Text size={12} style={styles.itemMeta} color={theme['c-font-label']}>{ '   ' + item.author }</Text>
                ) : null
              }
              {
                statusLabel ? (
                  <Text size={12} style={styles.itemMeta} color={theme['c-primary-font']}>{ '   ' + statusLabel }</Text>
                ) : null
              }
            </Text>
            {
              item.description ? (
                <Text size={12} color={theme['c-font-label']}>{item.description}</Text>
              ) : null
            }
          </View>
        </CheckBox>
        {
          item.builtin == 'local' && !item.updateUrl && !item.scriptUpdateUrl
            ? <Text size={12} color={theme['c-font-label']}>{t('builtin_source_local_fixed')}</Text>
            : null
        }
      </View>
      <View style={styles.listItemRight}>
        <TouchableOpacity
          style={[styles.btn, busy && !checking && styles.btnDisabled]}
          onPress={handleCheckUpdate}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('user_api_update_check_button')}
          accessibilityState={{ busy: checking }}
        >
          {
            checking
              ? <Loading size={15} color={theme['c-button-font']} />
              : <Icon name="available_updates" color={theme['c-button-font']} />
          }
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, busy && styles.btnDisabled]}
          onPress={handleManualUpdate}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('user_api_manual_update_button')}
        >
          <Icon name="download-2" color={theme['c-button-font']} />
        </TouchableOpacity>
        {
          item.builtin
            ? null
            : (
                <TouchableOpacity
                  style={[styles.btn, busy && styles.btnDisabled]}
                  onPress={handleRemove}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={global.i18n.t('delete')}
                >
                  <Icon name="close" color={theme['c-button-font']} />
                </TouchableOpacity>
              )
        }
      </View>
    </View>
  )
}

export interface UserApiEditModalProps {
  onSave: (rules: string) => void
  // onSourceChange: SourceSelectorProps['onSourceChange']
}
export interface UserApiEditModalType {
  show: (rules: string) => void
}


export default ({ scope = 'custom' }: { scope?: 'custom' | 'builtin' }) => {
  const userApiList = useUserApiList()
  const apiSource = useSettingValue('common.apiSource')
  const theme = useTheme()
  const t = useI18n()
  const checkModalRef = useRef<UpdateCheckModalType>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [builtinTab, setBuiltinTab] = useState<'online' | 'local'>('online')
  // 一次只放行一个检查：连点两下时 state 还没刷新，靠 ref 先把第二下挡住
  const checkingRef = useRef(false)

  const visibleList = useMemo(() => {
    if (scope == 'custom') return userApiList.filter(item => !item.builtin)
    return pickBuiltinSources(userApiList, builtinTab)
  }, [userApiList, scope, builtinTab])
  const tabs = useMemo(() => ([
    { kind: 'online' as const, label: t('builtin_source_tab_online') },
    { kind: 'local' as const, label: t('builtin_source_tab_local') },
  ]), [t])

  const handleRemove = useCallback(async(id: string, name: string) => {
    const confirm = await confirmDialog({
      message: global.i18n.t('user_api_remove_tip', { name }),
      cancelButtonText: global.i18n.t('cancel_button_text_2'),
      confirmButtonText: global.i18n.t('confirm_button_text'),
      bgClose: false,
    })
    if (!confirm) return
    void removeUserApi([id]).finally(() => {
      if (settingState.setting['common.apiSource'] == id) {
        let backApiId = apiSourceInfo.find(api => !api.disabled)?.id
        if (!backApiId) backApiId = userApiState.list[0]?.id
        setApiSource(backApiId ?? '')
      }
    })
  }, [])
  const handleSelectSource = useCallback((id: string) => {
    setApiSource(id)
  }, [])
  const handleCheckUpdate = useCallback(async(item: LX.UserApi.UserApiInfo) => {
    if (checkingRef.current) return
    checkingRef.current = true
    setCheckingId(item.id)
    try {
      const preview = await runUpdatePreview(item.id)
      if (preview.status != 'available') {
        toastPreview(item.name, preview)
        return
      }
      const confirm = await confirmDialog({
        message: buildPreviewConfirmMessage(preview),
        cancelButtonText: global.i18n.t('cancel_button_text_2'),
        confirmButtonText: global.i18n.t('confirm_button_text'),
        bgClose: false,
      })
      if (!confirm) return
      toastUpdateOutcome(item.name, await runUpdateApply(item.id, preview))
    } finally {
      checkingRef.current = false
      setCheckingId(null)
    }
  }, [])
  const handleManualUpdate = useCallback((item: LX.UserApi.UserApiInfo) => {
    checkModalRef.current?.show(item)
  }, [])

  return (
    <ScrollView style={styles.scrollView} keyboardShouldPersistTaps={'always'}>
      <View onStartShouldSetResponder={() => true}>
        {
          scope == 'builtin'
            ? (
                <View style={styles.tabs}>
                  {
                    tabs.map(tab => {
                      const active = builtinTab == tab.kind
                      return (
                        <TouchableOpacity
                          key={tab.kind}
                          style={[styles.tab, active && { backgroundColor: theme['c-primary-background-active'] }]}
                          onPress={() => { setBuiltinTab(tab.kind) }}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                        >
                          <Text size={13} color={active ? theme['c-primary-font'] : theme['c-font-label']}>{tab.label}</Text>
                        </TouchableOpacity>
                      )
                    })
                  }
                </View>
              )
            : null
        }
        {
          scope == 'builtin'
            ? <Text style={styles.tabDesc} size={12} color={theme['c-font-label']}>{t(builtinTab == 'online' ? 'builtin_source_tab_online_desc' : 'builtin_source_tab_local_desc')}</Text>
            : null
        }
        {
          visibleList.length
            ? visibleList.map((item) => {
              return (
              <ListItem
                key={item.id}
                item={item}
                activeId={apiSource}
                checking={checkingId == item.id}
                busy={checkingId != null}
                onSelect={handleSelectSource}
                onRemove={handleRemove}
                onCheckUpdate={handleCheckUpdate}
                onManualUpdate={handleManualUpdate}
              />
              )
            })
            : (
                <Text style={styles.tipText} color={theme['c-font-label']}>
                  {
                    scope == 'builtin'
                      ? t(builtinTab == 'online' ? 'builtin_source_empty_online' : 'builtin_source_empty_local')
                      : t('user_api_empty')
                  }
                </Text>
              )
        }
        <UpdateCheckModal ref={checkModalRef} />
      </View>
    </ScrollView>
  )
}


const styles = createStyle({
  scrollView: {
    paddingHorizontal: 7,
    flexGrow: 0,
  },
  tabs: {
    flexDirection: 'row',
    padding: 3,
    marginBottom: 6,
    borderRadius: BorderRadius.normal,
    backgroundColor: 'rgba(128, 128, 128, 0.12)',
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: BorderRadius.normal,
  },
  tabDesc: {
    marginBottom: 8,
    paddingHorizontal: 3,
    lineHeight: 17,
  },
  list: {
    paddingBottom: 15,
    flexDirection: 'column',
  },
  listItem: {
    padding: 10,
    borderRadius: BorderRadius.normal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listItemLeft: {
    paddingRight: 10,
    flex: 1,
    gap: 2,
  },
  nameBlock: {
    gap: 2,
  },
  itemName: {
    fontWeight: 'bold',
  },
  itemMeta: {
    fontWeight: 'normal',
  },
  listItemRight: {
    flex: 0,
    flexDirection: 'row',
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  // btns: {
  //   padding: 5,
  // },
  btn: {
    padding: 10,
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  tipText: {
    textAlign: 'center',
    marginTop: 25,
    marginBottom: 15,
  },
})


