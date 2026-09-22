// import { useLrcPlay } from '@/plugins/lyric'
import { useStatusText } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useGlassColors } from '@/utils/hooks/useGlassColors'


export default () => {
  const glassColors = useGlassColors()
  // const { text } = useLrcPlay()
  const statusText = useStatusText()
  // console.log('render status')

  // const status = playerStatus.isPlay ? text : playerStatus.statusText

  return <Text style={styles.text} numberOfLines={1} size={13} color={glassColors.text}>{statusText}</Text>
}

const styles = createStyle({
  text: {
    textAlign: 'center',
  },
})
