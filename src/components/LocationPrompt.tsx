import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { geocode, type Place } from '../lib/location'
import { fonts, usePalette } from '../theme'

/** Shown when location permission is denied (or the user wants another place): type a city or ZIP. */
export function LocationPrompt({ onPlace, onRetryDevice }: { onPlace: (p: Place) => void; onRetryDevice?: () => void }) {
  const c = usePalette()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const p = await geocode(q)
      if (p) onPlace(p)
      else setError("Couldn't find that place. Try a city name or 5-digit ZIP.")
    } catch {
      setError('Lookup failed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: c.text }]}>Where are you?</Text>
      <Text style={[styles.body, { color: c.muted }]}>Enter a city or ZIP to see events nearby.</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        onSubmitEditing={submit}
        placeholder="Detroit, MI or 48226"
        placeholderTextColor={c.muted}
        autoCapitalize="words"
        returnKeyType="search"
        style={[styles.input, { backgroundColor: c.card, color: c.text, borderColor: c.chipBorder }]}
      />
      <Pressable onPress={submit} disabled={busy || !q.trim()} style={[styles.button, { backgroundColor: c.accent, opacity: busy || !q.trim() ? 0.6 : 1 }]}>
        {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={[styles.buttonText, { color: c.onAccent }]}>Show events</Text>}
      </Pressable>
      {error ? <Text style={[styles.body, { color: '#C0392B', marginTop: 12 }]}>{error}</Text> : null}
      {onRetryDevice ? (
        <Pressable onPress={onRetryDevice} style={{ marginTop: 18 }}>
          <Text style={[styles.link, { color: c.accent }]}>Use my location instead</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 80 },
  title: { fontFamily: fonts.heading, fontSize: 28, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 16, marginBottom: 16 },
  input: { fontFamily: fonts.body, fontSize: 17, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  button: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 16 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, textAlign: 'center' },
})
