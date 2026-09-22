import { useEffect, useState } from 'react'
import { Keyboard } from 'react-native'

const inputFocusListeners = new Set()

export const notifyKeyboardWillShow = () => {
  inputFocusListeners.forEach(listener => listener())
}

export default () => {
  const [shown, setShown] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const handleKeyboardDidShow = e => {
    // const isShow = e.endCoordinates.height > 115
    // setShown(isShow)
    // setKeyboardHeight(isShow ? e.endCoordinates.height : 0)
    setShown(true)
    setKeyboardHeight(e.endCoordinates.height)
  }

  const handleKeyboardDidHide = () => {
    setShown(false)
    setKeyboardHeight(0)
  }

  useEffect(() => {
    const handleInputFocus = () => {
      setShown(true)
    }

    inputFocusListeners.add(handleInputFocus)
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', handleKeyboardDidShow)
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', handleKeyboardDidHide)

    return () => {
      inputFocusListeners.delete(handleInputFocus)
      keyboardDidShow.remove()
      keyboardDidHide.remove()
    }
  }, [])

  return {
    keyboardShown: shown,
    keyboardHeight,
  }
}


