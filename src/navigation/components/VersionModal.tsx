import { useMemo, useState, useEffect, useCallback, memo } from 'react'
import { View, ScrollView } from 'react-native'

import { compareVer, sizeFormate } from '@/utils'

import Button from '@/components/common/Button'
import { getBrowserDownloadUrl, updateApp } from '@/utils/version'
import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { type VersionInfo } from '@/store/version/state'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useVersionDownloadProgressUpdated, useVersionInfo, useVersionInfoIgnoreVersionUpdated } from '@/store/version/hook'
import ModalContent from './ModalContent'
import { checkUpdate, downloadUpdate, hideModal, setIgnoreVersion } from '@/core/version'
import { useBackHandler } from '@/utils/hooks/useBackHandler'

// 换包名分界版本：从低于此版本升级到不低于此版本时，会安装成不同包名的新应用，
// 桌面同时出现两个图标、新旧数据不互通，需要用户手动迁移歌单。
// 以"是否跨越该分界"为判据，可覆盖跳过中间版本直接升级的情况；升级到更高版本后不再提示。
const PACKAGE_CHANGE_BASELINE = '1.3.0'

const MigrateNotice = memo(({ newVersion }: { newVersion?: string }) => {
  const t = useI18n()
  const theme = useTheme()
  const crossingChange = !!newVersion &&
    compareVer(currentVer, PACKAGE_CHANGE_BASELINE) < 0 &&
    compareVer(newVersion, PACKAGE_CHANGE_BASELINE) >= 0
  if (!crossingChange) return null
  return (
    <View style={[styles.migrateBox, { borderColor: theme['c-primary'], backgroundColor: theme['c-primary-alpha-900'] }]}>
      <Text style={styles.migrateTitle} color={theme['c-primary']}>{t('version_migrate_title')}</Text>
      <Text style={styles.migrateHighlight}>{t('version_migrate_highlight')}</Text>
      <Text style={styles.migrateStep}>{t('version_migrate_step1')}</Text>
      <Text style={styles.migrateStep}>{t('version_migrate_step2')}</Text>
      <Text style={styles.migrateStep}>{t('version_migrate_step3')}</Text>
      <Text style={styles.migrateNote}>{t('version_migrate_note')}</Text>
    </View>
  )
})

const VersionItem = ({ version, desc }: VersionInfo) => {
  return (
    <View style={styles.versionItem}>
      <Text style={styles.label}>v{version}</Text>
      <Text selectable style={styles.desc}>{desc}</Text>
    </View>
  )
}

const Content = memo(({ title, newVersionInfo }: {
  title: string
  newVersionInfo: VersionInfo | null
}) => {
  const t = useI18n()

  const history = useMemo(() => {
    if (!newVersionInfo?.history) return []
    let arr = []
    for (const ver of newVersionInfo?.history) {
      if (compareVer(currentVer, ver.version) < 0) arr.push(ver)
    }
    return arr
  }, [newVersionInfo])

  return (
    <View style={styles.main}>
      <Text style={styles.title}>{title}</Text>
      <MigrateNotice newVersion={newVersionInfo?.version} />
      <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
        <Text style={styles.label}>{t('version_label_latest_ver')}{newVersionInfo?.version}</Text>
        <Text style={styles.label}>{t('version_label_current_ver')}{currentVer}</Text>
        {
          newVersionInfo?.desc
            ? (
                <View>
                  <Text style={styles.label}>{t('version_label_change_log')}</Text>
                  <View style={{ paddingLeft: 10, marginTop: 5 }}>
                    <Text selectable style={styles.desc}>{newVersionInfo.desc}</Text>
                  </View>
                </View>
              )
            : null
        }
        {
          history.length
            ? (
                <View style={styles.history}>
                  <Text style={styles.label}>{t('version_label_history')}</Text>
                  <View style={{ paddingLeft: 10, marginTop: 5 }}>
                    {history.map((item, index) => <VersionItem key={index} version={item.version} desc={item.desc} />)}
                  </View>
                </View>
              )
            : null
        }
      </ScrollView>
    </View>
  )
})

const currentVer = String(process.versions.app)
const VersionModal = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const versionInfo = useVersionInfo()
  const progress = useVersionDownloadProgressUpdated()
  const ignoreVersion = useVersionInfoIgnoreVersionUpdated()
  const [ignoreBtn, setIgnoreBtn] = useState({ text: t('version_btn_ignore'), show: true, disabled: false })
  const [closeBtnText, setCloseBtnText] = useState(t('version_btn_close'))
  const [confirmBtn, setConfirmBtn] = useState({ text: '', show: true, disabled: false })
  const [title, setTitle] = useState('')
  const [tip, setTip] = useState('')


  useEffect(() => {
    let ignoreBtnConfig = { ...ignoreBtn }
    if (versionInfo.isLatest) {
      setTitle(t('version_title_latest'))
      setTip('')
      ignoreBtnConfig.show = false
      setConfirmBtn({ text: t('version_btn_new'), show: false, disabled: true })
      setCloseBtnText(t('version_btn_close'))
    } else if (versionInfo.isUnknown) {
      setTitle(t('version_title_unknown'))
      setTip(t('version_tip_unknown'))
      ignoreBtnConfig.show = false
      setConfirmBtn({ text: t('version_btn_failed'), show: true, disabled: false })
      setCloseBtnText(t('version_btn_close'))
    } else {
      switch (versionInfo.status) {
        case 'downloading':
          setTitle(t('version_title_new'))
          setTip(t('version_btn_downloading', {
            total: sizeFormate(progress.total),
            current: sizeFormate(progress.current),
            progress: progress.total ? (progress.current / progress.total * 100).toFixed(2) : '0',
          }))
          if (ignoreBtnConfig.show) ignoreBtnConfig.show = false
          if (!confirmBtn.disabled) setConfirmBtn({ text: t('version_btn_update'), show: true, disabled: true })
          setCloseBtnText(t('version_btn_min'))
          break
        case 'downloaded':
          setTitle(t('version_title_update'))
          setTip('')
          if (ignoreBtnConfig.show) ignoreBtnConfig.show = false
          setConfirmBtn({ text: t('version_btn_update'), show: true, disabled: false })
          setCloseBtnText(t('version_btn_close'))
          break
        case 'checking':
          setTitle(t('version_title_checking'))
          setTip('')
          ignoreBtnConfig.show = false
          setConfirmBtn({ text: t('version_btn_new'), show: false, disabled: true })
          setCloseBtnText(t('version_btn_close'))
          break
        case 'error':
          setTitle(t('version_title_failed'))
          setTip(t('version_tip_failed'))
          ignoreBtnConfig.show = true
          ignoreBtnConfig.disabled = false
          setConfirmBtn({ text: t('version_btn_failed'), show: true, disabled: false })
          setCloseBtnText(t('version_btn_close'))
          break
        // case 'idle':
        //   break
        default:
          setTitle(t('version_title_new'))
          setTip('')
          ignoreBtnConfig.show = true
          ignoreBtnConfig.disabled = false
          setConfirmBtn({ text: t('version_btn_new'), show: true, disabled: false })
          // setTip(t('version_btn_new'))
          setCloseBtnText(t('version_btn_close'))
          break
      }
    }
    ignoreBtnConfig.text = t(ignoreVersion == versionInfo.newVersion?.version ? 'version_btn_ignore_cancel' : 'version_btn_ignore')
    setIgnoreBtn(ignoreBtnConfig)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, versionInfo, ignoreVersion, progress])

  const handleCancel = () => {
    hideModal(componentId)
  }

  // 系统返回：先关这张窗口，不让事件落到下面那页。
  //
  // 这是 overlay，不是 RN Modal —— 它盖在设置页上，但设置页的 useBackHandler 仍然注册着
  // （Setting/index.tsx 在 nav_setting 且 detailId 非空时，会把"软件更新"子页退回设置主列表
  // 并 return true）。RN 的 hardwareBackPress 是后注册先执行，本窗口挂载晚于设置页，
  // 在这里消费掉，返回键就不会穿透改掉底下的导航状态、把窗口孤零零留在原地。
  const handleBack = useCallback(() => {
    hideModal(componentId)
    return true
  }, [componentId])
  useBackHandler(handleBack)

  const handleIgnore = () => {
    setIgnoreVersion(ignoreVersion != versionInfo.newVersion!.version ? versionInfo.newVersion!.version : null)
    // handleCancel()
  }

  const handleConfirm = () => {
    if (versionInfo.isLatest || versionInfo.isUnknown) {
      void checkUpdate()
    } else if (versionInfo.status == 'downloaded') {
      void updateApp()
    } else if (versionInfo.status == 'idle' || versionInfo.status == 'error') {
      downloadUpdate()
    }
  }

  const handleBrowserDownload = async() => {
    const version = versionInfo.newVersion?.version
    if (!version) return
    await openUrl(await getBrowserDownloadUrl(version))
  }

  return (
    <ModalContent>
      <Content title={title} newVersionInfo={versionInfo.newVersion} />
      { tip.length ? <Text style={styles.tip} color={theme['c-primary-font']}>{tip}</Text> : null }
      <View style={styles.btns}>
        {
          ignoreBtn.show
            ? (
                <Button disabled={ignoreBtn.disabled} style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleIgnore}>
                  <Text color={theme['c-button-font']}>{ignoreBtn.text}</Text>
                </Button>
              )
            : null
        }
        {
          versionInfo.newVersion?.version && !versionInfo.isLatest
            ? (
                <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleBrowserDownload}>
                  <Text color={theme['c-button-font']}>{t('version_btn_browser')}</Text>
                </Button>
              )
            : null
        }
        <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleCancel}>
          <Text color={theme['c-button-font']}>{closeBtnText}</Text>
        </Button>
        {
          confirmBtn.show
            ? (
                <Button disabled={confirmBtn.disabled} style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={handleConfirm}>
                  <Text color={theme['c-button-font']}>{confirmBtn.text}</Text>
                </Button>
              )
            : null
        }
      </View>
    </ModalContent>
  )
}

const styles = createStyle({
  main: {
    // flexGrow: 0,
    flexShrink: 1,
    marginTop: 15,
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 20,
  },
  content: {
    flexGrow: 0,
  },
  migrateBox: {
    borderWidth: 1,
    borderRadius: 6,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 12,
    marginBottom: 15,
  },
  migrateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  migrateHighlight: {
    fontSize: 15,
    fontWeight: 'bold',
    lineHeight: 22,
    marginBottom: 8,
  },
  migrateStep: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  migrateNote: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 15,
  },
  history: {
    marginTop: 15,
  },
  versionItem: {
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    marginBottom: 2,
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
  },
  tip: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 10,
  },
  btns: {
    flexDirection: 'column',
    rowGap: 10,
    paddingBottom: 15,
    paddingLeft: 15,
    paddingRight: 15,
  },
  btn: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 12,
    alignItems: 'center',
    borderRadius: 4,
  },
})

export default VersionModal
