import { memo, useRef } from 'react'
import TimeoutExitEditModal, { type TimeoutExitEditModalType, useTimeInfo } from '@/components/TimeoutExitEditModal'
import SheetThemeProvider from '@/components/player/SheetThemeProvider'
import Btn from './Btn'
import { useGlassColors } from '@/utils/hooks/useGlassColors'


export default memo(() => {
  const glassColors = useGlassColors()
  const modalRef = useRef<TimeoutExitEditModalType>(null)

  const timeInfo = useTimeInfo()

  const handleShow = () => {
    modalRef.current?.show()
  }

  return (
    <>
      <Btn icon="music_time" label={global.i18n.t('timeout_exit_tip_off')} color={timeInfo.active ? glassColors.accent : glassColors.muted} onPress={handleShow} />
      <SheetThemeProvider>
        <TimeoutExitEditModal ref={modalRef} timeInfo={timeInfo} />
      </SheetThemeProvider>
    </>
  )
})
