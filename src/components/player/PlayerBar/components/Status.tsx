import { useStatusText } from '@/store/player/hook'
// import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'


export default ({ autoUpdate }: { autoUpdate: boolean }) => {
  const statusText = useStatusText()

  return <Text numberOfLines={1} size={12}>{statusText}</Text>
}

// const styles = createStyle({
//   text: {
//     // fontSize: 10,
//     // lineHeight: 18,
//     // height: 18,
//     // height: '100%',
//     // backgroundColor: 'rgba(0,0,0,0.2)',
//   },
// })
