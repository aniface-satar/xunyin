import { memo, useRef } from 'react'
import TimeoutExitEditModal, { type TimeoutExitEditModalType, useTimeInfo } from '@/components/TimeoutExitEditModal'
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
      <Btn icon="music_time" color={timeInfo.active ? glassColors.accent : glassColors.text} onPress={handleShow} />
      <TimeoutExitEditModal ref={modalRef} timeInfo={timeInfo} />
    </>
  )
})
