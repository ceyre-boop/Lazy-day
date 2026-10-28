import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque'
import { Nunito_400Regular, Nunito_700Bold, useFonts } from '@expo-google-fonts/nunito'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ActivityIndicator, useColorScheme, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LocationPrompt } from './src/components/LocationPrompt'
import { EventsScreen } from './src/EventsScreen'
import { clearPlace, getDevicePlace, loadPlace, loadRadius, savePlace, saveRadius, type Place } from './src/lib/location'
import { DEFAULT_RADIUS } from './src/lib/types'
import { usePalette } from './src/theme'

export default function App() {
  const [fontsLoaded] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, Nunito_400Regular, Nunito_700Bold })
  const c = usePalette()
  const scheme = useColorScheme()
  const [place, setPlace] = useState<Place | null>(null)
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    ;(async () => {
      setRadius(await loadRadius(DEFAULT_RADIUS))
      const saved = await loadPlace()
      if (saved) setPlace(saved)
      else {
        // First launch: ask for location. Denied -> LocationPrompt (city/ZIP) renders below.
        const device = await getDevicePlace().catch(() => null)
        if (device) {
          setPlace(device)
          savePlace(device)
        }
      }
      setBooting(false)
    })()
  }, [])

  const choose = (p: Place) => {
    setPlace(p)
    savePlace(p)
  }

  const retryDevice = async () => {
    const device = await getDevicePlace().catch(() => null)
    if (device) choose(device)
  }

  if (!fontsLoaded || booting) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {place ? (
          <EventsScreen
            place={place}
            radius={radius}
            onRadius={(r) => {
              setRadius(r)
              saveRadius(r)
            }}
            onChangePlace={() => {
              clearPlace()
              setPlace(null)
            }}
          />
        ) : (
          <LocationPrompt onPlace={choose} onRetryDevice={retryDevice} />
        )}
      </View>
    </SafeAreaProvider>
  )
}
