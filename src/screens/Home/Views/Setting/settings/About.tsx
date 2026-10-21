/**
 * 基于 lyswhut/lx-music-mobile 修改（Apache License 2.0）。
 * 调整“关于”页内容，以说明本应用的界面重构定位与歌单导入能力。
 * 原项目：https://github.com/lyswhut/lx-music-mobile
 */

import { memo } from 'react'
import { View, TouchableOpacity, Linking } from 'react-native'

import Section from '../components/Section'
// import Button from './components/Button'

import { clipboardWriteText, createStyle, openUrl, toast } from '@/utils/tools'
// import { showPactModal } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { showPactModal } from '@/core/common'

// const qqGroupUrl = 'mqqopensdkapi://bizAgent/qm/qr?url=http%3A%2F%2Fqm.qq.com%2Fcgi-bin%2Fqm%2Fqr%3Ffrom%3Dapp%26p%3Dandroid%26jump_from%3Dwebapi%26k%3Du1zyxek8roQAwic44nOkBXtG9CfbAxFw'
// const qqGroupUrl2 = 'mqqopensdkapi://bizAgent/qm/qr?url=http%3A%2F%2Fqm.qq.com%2Fcgi-bin%2Fqm%2Fqr%3Ffrom%3Dapp%26p%3Dandroid%26jump_from%3Dwebapi%26k%3D-l4kNZ2bPQAuvfCQFFhl1UoibvF5wcrQ'
// const qqGroupWebUrl = 'https://qm.qq.com/cgi-bin/qm/qr?k=jRZkyFSZ4FmUuTHA3P_RAXbbUO_Rrn5e&jump_from=webapi'
// const qqGroupWebUrl2 = 'https://qm.qq.com/cgi-bin/qm/qr?k=HPNJEfrZpBZ9T8szYWbe2d5JrAAeOt_l&jump_from=webapi'

// 小红书主页分享链接与口令
const xhsUrl = 'https://xhslink.cn/o/1LHpR5F726l'
const xhsShareText = '我在小红书收获了20次赞与收藏，点击链接或复制口令来看我的主页>> https://xhslink.cn/o/1LHpR5F726l'
// 官方 QQ 群：用 mqqapi 直接打开群卡片（加入页），客户端不存在时退化为复制群号
const qqGroupNumber = '1125210014'
const qqGroupScheme = `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${qqGroupNumber}&card_type=group&source=qrcode`

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const openHomePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#readme')
  }
  // const openIssuesPage = () => {
  //   openUrl('https://github.com/lyswhut/lx-music-mobile/issues')
  // }
  const openPactModal = () => {
    showPactModal()
  }
  const openPartPage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#%E9%A1%B9%E7%9B%AE%E5%8D%8F%E8%AE%AE')
  }
  const openXhsPage = () => {
    void openUrl(xhsUrl)
  }
  const copyXhsShareText = () => {
    clipboardWriteText(xhsShareText)
    toast(t('about_xhs_copy_tip'))
  }
  const openQQGroup = () => {
    void Linking.openURL(qqGroupScheme).catch(() => {
      clipboardWriteText(qqGroupNumber)
      toast(t('about_qq_copy_tip', { group: qqGroupNumber }), 'long')
    })
  }
  const copyQQGroupNumber = () => {
    clipboardWriteText(qqGroupNumber)
    toast(t('about_qq_copy_done'))
  }

  // const goToQQGroup = () => {
  //   openUrl(qqGroupUrl).catch(() => {
  //     void openUrl(qqGroupWebUrl)
  //   })
  // }
  // const goToQQGroup2 = () => {
  //   openUrl(qqGroupUrl2).catch(() => {
  //     void openUrl(qqGroupWebUrl2)
  //   })
  // }

  const textLinkStyle = {
    ...styles.text,
    textDecorationLine: 'underline',
    color: theme['c-primary-font'],
    // fontSize: 14,
  } as const


  const backupDataLabel = t('setting_backup_part').split('（')[0].split('(')[0]

  return (
    <Section title={t('setting_about')}>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_desc')}</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_import_title')}</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_import_full', {
          setting: t('nav_setting'),
          backup: t('setting_backup'),
          data: backupDataLabel,
          importList: t('setting_backup_part_import_list'),
        })}</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_import_single', {
          library: t('nav_love'),
          import: t('list_import'),
        })}</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_upstream')}</Text>
        <TouchableOpacity onPress={openHomePage}>
          <Text style={textLinkStyle}>https://github.com/lyswhut/lx-music-mobile</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_signed_prefix')}</Text>
        <TouchableOpacity onPress={openPactModal}><Text style={textLinkStyle}>{t('about_pact_link')}</Text></TouchableOpacity>
        <Text style={styles.text}>{t('about_upstream_mid')}</Text>
        <TouchableOpacity onPress={openPartPage}><Text style={textLinkStyle}>{t('about_here')}</Text></TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.text}>{t('about_thanks')}</Text>
      </View>
      <View style={styles.community}>
        <Text style={styles.communityTitle}>{t('about_community_title')}</Text>
        <Text style={styles.communityDesc} size={13} color={theme['c-font-label']}>{t('about_community_desc')}</Text>
        <View style={{ ...styles.communityCard, backgroundColor: theme['c-primary-background'], borderColor: theme['c-border-background'] }}>
          <TouchableOpacity
            style={styles.communityRow}
            activeOpacity={0.7}
            onPress={openXhsPage}
            onLongPress={copyXhsShareText}
          >
            <View style={styles.communityRowTop}>
              <View style={{ ...styles.chip, borderColor: theme['c-primary-alpha-500'] }}>
                <Text style={styles.chipText} size={11} color={theme['c-primary-font']}>{t('about_xhs_chip')}</Text>
              </View>
              <Text style={styles.communityRowMain} size={15}>{t('about_xhs_title')}</Text>
              <View style={styles.communityRowSpace} />
              <Text size={13} color={theme['c-primary-font']} numberOfLines={1}>{t('about_xhs_action')}</Text>
              <Icon name="chevron-right" size={12} color={theme['c-font-label']} style={styles.communityRowArrow} />
            </View>
            <Text style={styles.communityRowDesc} size={12} color={theme['c-font-label']}>{t('about_xhs_desc')}</Text>
          </TouchableOpacity>
          <View style={{ ...styles.communityDivider, backgroundColor: theme['c-border-background'] }} />
          <TouchableOpacity
            style={styles.communityRow}
            activeOpacity={0.7}
            onPress={openQQGroup}
            onLongPress={copyQQGroupNumber}
          >
            <View style={styles.communityRowTop}>
              <View style={{ ...styles.chip, borderColor: theme['c-primary-alpha-500'] }}>
                <Text style={styles.chipText} size={11} color={theme['c-primary-font']}>{t('about_qq_chip')}</Text>
              </View>
              <Text style={styles.groupNumber} size={16}>{qqGroupNumber}</Text>
              <View style={styles.communityRowSpace} />
              <Text size={13} color={theme['c-primary-font']} numberOfLines={1}>{t('about_qq_action')}</Text>
              <Icon name="chevron-right" size={12} color={theme['c-font-label']} style={styles.communityRowArrow} />
            </View>
            <Text style={styles.communityRowDesc} size={12} color={theme['c-font-label']}>{t('about_qq_desc')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.communityHint} size={11.5} color={theme['c-font-label']}>{t('about_copy_hint')}</Text>
      </View>
    </Section>
  )
})

const styles = createStyle({
  part: {
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  community: {
    marginTop: 5,
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 10,
  },
  communityTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  communityDesc: {
    marginTop: 6,
    lineHeight: 19,
  },
  communityCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  communityRow: {
    paddingLeft: 13,
    paddingRight: 11,
    paddingTop: 12,
    paddingBottom: 12,
  },
  communityRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  communityRowSpace: {
    flex: 1,
  },
  chip: {
    borderRadius: 5,
    borderWidth: 1,
    paddingLeft: 5,
    paddingRight: 5,
    paddingTop: 2,
    paddingBottom: 2,
  },
  chipText: {
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  communityRowMain: {
    marginLeft: 9,
  },
  groupNumber: {
    marginLeft: 9,
    letterSpacing: 1,
    fontWeight: '500',
  },
  communityRowDesc: {
    marginTop: 5,
  },
  communityRowArrow: {
    marginLeft: 2,
  },
  communityDivider: {
    // height 会经 scaleSizeH 取整，小于 2 会被压成 0（分隔线画不出来）
    height: 2,
    marginLeft: 13,
    marginRight: 13,
  },
  communityHint: {
    marginTop: 7,
  },
  text: {
    fontSize: 14,
    textAlignVertical: 'bottom',
  },
  boldText: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlignVertical: 'bottom',
  },
  throughText: {
    fontSize: 14,
    textDecorationLine: 'line-through',
    textAlignVertical: 'bottom',
  },
  btn: {
    flexDirection: 'row',
  },
})
