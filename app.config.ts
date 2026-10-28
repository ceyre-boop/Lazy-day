import type { ExpoConfig } from 'expo/config'

// Only the two public Supabase values reach the bundle. TICKETMASTER_API_KEY and
// SUPABASE_SERVICE_ROLE_KEY stay server-side and are never read here.
const config: ExpoConfig = {
  name: 'Lazy Day',
  slug: 'lazy-day',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#EEF6F1',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.lazyday.app',
    infoPlist: { NSLocationWhenInUseUsageDescription: 'Lazy Day uses your location to show events near you.' },
  },
  android: {
    package: 'com.lazyday.app',
    permissions: ['ACCESS_COARSE_LOCATION'],
    adaptiveIcon: {
      backgroundColor: '#EEF6F1',
      foregroundImage: './assets/android-icon-foreground.png',
    },
  },
  plugins: ['expo-font', 'expo-location', ['expo-splash-screen', { image: './assets/splash-icon.png', backgroundColor: '#EEF6F1', imageWidth: 160 }]],
  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  },
}

export default config
