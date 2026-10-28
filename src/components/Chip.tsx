import { Pressable, StyleSheet, Text } from 'react-native'
import { fonts, usePalette } from '../theme'

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = usePalette()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? c.accent : c.chip, borderColor: selected ? c.accent : c.chipBorder }]}
    >
      <Text style={[styles.text, { color: selected ? c.onAccent : c.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginRight: 8 },
  text: { fontFamily: fonts.bodyBold, fontSize: 14 },
})
