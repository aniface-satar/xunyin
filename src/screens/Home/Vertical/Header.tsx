import { View, TouchableOpacity } from 'react-native'
// import Button from '@/components/common/Button'
// import { navigations } from '@/navigation'
// import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import StatusBar from '@/components/common/StatusBar'
import { useSettingValue } from '@/store/setting/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT } from '@/config/constant'
import { getHeaderActions } from './headerActions'
import { type InitState as CommonState } from '@/store/common/state'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'
import { setSettingDetailId, useSettingDetailId } from '@/screens/Home/Views/Setting/detailId'
import { MylistSearchBar, MylistSearchButton, useMylistSearch } from '@/screens/Home/Views/Mylist/Search'
import type { SettingScreenIds } from '@/screens/Home/Views/Setting/Main'

const SettingsButton = () => {
  const theme = useTheme()

  return (
    <TouchableOpacity style={styles.settingsBtn} onPress={() => { setNavActiveId('nav_setting') }}>
      <Icon color={theme['c-font']} name="setting" size={18} />
    </TouchableOpacity>
  )
}

const SettingsBackButton = ({ detailId }: {
  detailId: SettingScreenIds | null
}) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={styles.backBtn}
      activeOpacity={0.8}
      onPress={() => {
        if (detailId != null) {
          setSettingDetailId(null)
        } else {
          setNavActiveId(commonState.lastNavActiveId)
        }
      }}
    >
      <Icon color={theme['c-font']} name="chevron-left" size={20} />
    </TouchableOpacity>
  )
}

const HeaderActions = ({ id }: {
  id: CommonState['navActiveId']
}) => {
  const actions = getHeaderActions(id)

  if (actions.length == 0) return null

  return (
    <View style={styles.headerActions}>
      {actions.map(action => action == 'mylistSearch'
        ? <MylistSearchButton key={action} />
        : <SettingsButton key={action} />)}
    </View>
  )
}


// const LeftTitle = () => {
//   const id = useNavActiveId()
//   const t = useI18n()

//   return <Text style={styles.leftTitle} size={18}>{t(id)}</Text>
// }
const LeftHeader = () => {
  const id = useNavActiveId()
  const settingDetailId = useSettingDetailId()
  const { isSearchMode } = useMylistSearch()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()

  return (
    <View style={{
      ...styles.container,
      height: scaleSizeH(HEADER_HEIGHT) + statusBarHeight,
      paddingTop: statusBarHeight,
    }}>
      {
        id == 'nav_love' && isSearchMode
          ? <MylistSearchBar />
          : (
              <>
                {id == 'nav_setting' ? <SettingsBackButton detailId={settingDetailId} /> : null}
                <View style={styles.left}>
                  <TouchableOpacity style={styles.titleBtn}>
                    <Text style={styles.leftTitle} size={18}>
                      {t(id == 'nav_setting' && settingDetailId != null ? `setting_${settingDetailId}` : id)}
                    </Text>
                  </TouchableOpacity>
                </View>
                <HeaderActions id={id} />
              </>
            )
      }
    </View>
  )
}


// const RightTitle = () => {
//   const id = useNavActiveId()
//   const t = useI18n()

//   return <Text style={styles.rightTitle} size={18}>{t(id)}</Text>
// }
const RightHeader = () => {
  const t = useI18n()
  const id = useNavActiveId()
  const settingDetailId = useSettingDetailId()
  const { isSearchMode } = useMylistSearch()
  const statusBarHeight = useStatusbarHeight()
  return (
    <View style={{
      ...styles.container,
      height: scaleSizeH(HEADER_HEIGHT) + statusBarHeight,
      paddingTop: statusBarHeight,
    }}>
      {
        id == 'nav_love' && isSearchMode
          ? <MylistSearchBar />
          : (
              <>
                {id == 'nav_setting' ? <SettingsBackButton detailId={settingDetailId} /> : null}
                <View style={styles.left}>
                  <TouchableOpacity style={styles.titleBtn}>
                    <Text style={styles.rightTitle} size={18}>
                      {t(id == 'nav_setting' && settingDetailId != null ? `setting_${settingDetailId}` : id)}
                    </Text>
                  </TouchableOpacity>
                </View>
                <HeaderActions id={id} />
              </>
            )
      }
    </View>
  )
}

const Header = () => {
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')

  return (
    <>
      <StatusBar />
      {
        drawerLayoutPosition == 'left'
          ? <LeftHeader />
          : <RightHeader />
      }

    </>
  )
}


const styles = createStyle({
  container: {
    // width: '100%',
    paddingRight: 5,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor: 'rgba(0,0,0,0.1)',
    zIndex: 10,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    paddingLeft: 5,
    alignItems: 'center',
    height: '100%',
  },
  btn: {
    // flex: 1,
    width: HEADER_HEIGHT,
    // backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  titleBtn: {
    flex: 1,
    // backgroundColor: 'rgba(0,0,0,0.1)',
    height: '100%',
    justifyContent: 'center',
  },
  leftTitle: {
    paddingLeft: 14,
    paddingRight: 16,
  },
  rightTitle: {
    paddingLeft: 16,
    paddingRight: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
  },
  settingsBtn: {
    width: 38,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 38,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
})

export default Header
