import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Chip } from './components/Chip'
import { EventCard } from './components/EventCard'
import { dayChips, filterEvents, groupByDay, updatedLabel } from './lib/events'
import type { Place } from './lib/location'
import { supabase, supabaseConfigured } from './lib/supabase'
import { DEFAULT_RADIUS, RADIUS_OPTIONS, TYPE_CHIPS, type AppEvent, type EventType } from './lib/types'
import { fonts, usePalette } from './theme'

interface Props {
  place: Place
  radius: number
  onRadius: (r: number) => void
  onChangePlace: () => void
}

export function EventsScreen({ place, radius, onRadius, onChangePlace }: Props) {
  const c = usePalette()
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [types, setTypes] = useState<Set<EventType>>(new Set())
  const now = useMemo(() => new Date(), [events])

  const load = useCallback(async () => {
    if (!supabaseConfigured) {
      setError('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env and restart.')
      return
    }
    const { data, error: err } = await supabase.rpc('events_near', { user_lat: place.lat, user_lng: place.lng, radius_mi: radius })
    if (err) setError(err.message)
    else {
      setError(null)
      setEvents((data ?? []) as AppEvent[])
    }
  }, [place.lat, place.lng, radius])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const toggle = (t: EventType) =>
    setTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const sections = useMemo(() => groupByDay(filterEvents(events, day, types), now), [events, day, types, now])
  const chips = useMemo(() => dayChips(now), [now])

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.h1, { color: c.text }]}>Lazy Day</Text>
        <View style={styles.placeRow}>
          <Text onPress={onChangePlace} style={[styles.place, { color: c.accent }]} numberOfLines={1}>
            {place.label} ✎
          </Text>
          <View style={styles.radii}>
            {RADIUS_OPTIONS.map((r) => (
              <Text
                key={r}
                onPress={() => onRadius(r)}
                style={[styles.radius, { color: r === radius ? c.onAccent : c.muted, backgroundColor: r === radius ? c.accent : 'transparent' }]}
              >
                {r} mi
              </Text>
            ))}
          </View>
        </View>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {chips.map((d) => (
            <Chip key={d.label} label={d.label} selected={day === d.key} onPress={() => setDay(d.key)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {TYPE_CHIPS.map((t) => (
            <Chip key={t.key} label={t.label} selected={types.has(t.key)} onPress={() => toggle(t.key)} />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} />
      ) : error ? (
        <Text style={[styles.empty, { color: c.muted }]}>{error}</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <EventCard event={item} />}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.dayHeader, { color: c.text, backgroundColor: c.bg }]}>{section.title}</Text>
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.accent]} />}
          ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>Nothing matches those filters. Try turning one off.</Text>}
          ListFooterComponent={events.length ? <Text style={[styles.footer, { color: c.muted }]}>{updatedLabel(events)}</Text> : undefined}
        />
      )}
    </SafeAreaView>
  )
}

export { DEFAULT_RADIUS }

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  h1: { fontFamily: fonts.heading, fontSize: 30 },
  placeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  place: { fontFamily: fonts.bodyBold, fontSize: 15, flexShrink: 1, marginRight: 8 },
  radii: { flexDirection: 'row' },
  radius: { fontFamily: fonts.bodyBold, fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  chipRow: { paddingHorizontal: 16, paddingVertical: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  dayHeader: { fontFamily: fonts.heading, fontSize: 20, paddingTop: 12, paddingBottom: 6 },
  empty: { fontFamily: fonts.body, fontSize: 16, textAlign: 'center', marginTop: 48, paddingHorizontal: 24 },
  footer: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginTop: 16 },
})
