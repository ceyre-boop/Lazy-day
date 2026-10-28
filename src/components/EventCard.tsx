import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { noteLabel, timeLabel } from '../lib/events'
import type { AppEvent } from '../lib/types'
import { fonts, usePalette } from '../theme'

const TAG_LABEL: Record<string, string> = {
  kids: 'Kids', music: 'Music', sports: 'Sports', shows: 'Shows', seasonal: 'Haunted/Seasonal', '21+': '21+',
}

export function EventCard({ event }: { event: AppEvent }) {
  const c = usePalette()
  const where = [event.venue, event.city].filter(Boolean).join(' · ')
  const note = noteLabel(event)
  const tags = event.categories.filter((t) => t !== 'free' && TAG_LABEL[t])
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.time, { color: c.accent }]}>{timeLabel(event)}</Text>
      <Text style={[styles.title, { color: c.text }]}>{event.title}</Text>
      {where ? <Text style={[styles.meta, { color: c.muted }]}>{where}</Text> : null}
      {note ? <Text style={[styles.meta, { color: c.muted }]}>{note}</Text> : null}
      <View style={styles.row}>
        <View style={styles.tags}>
          {event.is_free && (
            <View style={[styles.tag, { backgroundColor: c.free }]}>
              <Text style={[styles.tagText, { color: c.onFree }]}>Free</Text>
            </View>
          )}
          {tags.map((t) => (
            <View key={t} style={[styles.tag, { backgroundColor: c.bg }]}>
              <Text style={[styles.tagText, { color: c.muted }]}>{TAG_LABEL[t]}</Text>
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => Linking.openURL(event.source_url)}
          accessibilityRole="link"
          style={[styles.button, { backgroundColor: c.accent }]}
        >
          <Text style={[styles.buttonText, { color: c.onAccent }]}>Details</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  time: { fontFamily: fonts.bodyBold, fontSize: 13, marginBottom: 2 },
  title: { fontFamily: fonts.headingMedium, fontSize: 18, lineHeight: 23 },
  meta: { fontFamily: fonts.body, fontSize: 14, marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', flex: 1, gap: 6, marginRight: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 14 },
})
