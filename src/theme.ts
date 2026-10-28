import { useColorScheme } from 'react-native'

export const fonts = {
  heading: 'BricolageGrotesque_700Bold',
  headingMedium: 'BricolageGrotesque_600SemiBold',
  body: 'Nunito_400Regular',
  bodyBold: 'Nunito_700Bold',
}

const light = {
  bg: '#EEF6F1',
  card: '#FFFFFF',
  text: '#16302B',
  muted: '#5B7570',
  accent: '#2F7D74',
  onAccent: '#FFFFFF',
  chip: '#FFFFFF',
  chipBorder: '#CFE3DA',
  free: '#F2B33D',
  onFree: '#3A2A00',
  border: '#DCEBE3',
}

const dark: typeof light = {
  bg: '#0E1A17',
  card: '#172823',
  text: '#E7F3EE',
  muted: '#93AFA8',
  accent: '#2F7D74',
  onAccent: '#FFFFFF',
  chip: '#172823',
  chipBorder: '#2A4640',
  free: '#F2B33D',
  onFree: '#3A2A00',
  border: '#223832',
}

export type Palette = typeof light

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light
}
