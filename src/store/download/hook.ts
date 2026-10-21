import { useEffect, useState } from 'react'
import { state } from './state'
import { event } from './event'

export const useDownloadList = () => {
  const [list, setList] = useState(state.list)

  useEffect(() => {
    const handleUpdate = () => {
      setList(state.list)
    }
    event.on('download_changed', handleUpdate)
    return () => {
      event.off('download_changed', handleUpdate)
    }
  }, [])

  return list
}
