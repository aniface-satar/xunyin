import useWindowSize from './useWindowSize'
import { isHorizontalMode } from '../tools'


export default () => {
  const windowSize = useWindowSize()

  return isHorizontalMode(windowSize.width, windowSize.height)
}
