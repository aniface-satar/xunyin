import { useWindowDimensions } from 'react-native'

export interface TabletModeState {
  isTablet: boolean
  isWideLayout: boolean
  isLandscape: boolean
  width: number
  height: number
}

export const useTabletMode = (): TabletModeState => {
  const { width, height } = useWindowDimensions()
  const smallestWidth = Math.min(width, height)
  const isTablet = smallestWidth >= 600
  const isLandscape = width > height
  const isWideLayout = isTablet || isLandscape || width >= 600

  return {
    isTablet,
    isWideLayout,
    isLandscape,
    width,
    height,
  }
}
