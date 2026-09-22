import { View } from 'react-native'

interface Props {
  title: string
  children: React.ReactNode | React.ReactNode[]
}

export default ({ children }: Props) => <View>{children}</View>
