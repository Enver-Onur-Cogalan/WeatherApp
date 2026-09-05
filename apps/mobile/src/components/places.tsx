/**
 * Choosing and keeping places.
 *
 * One component, used from two directions: İz opens it as a sheet to switch the place on
 * screen, and Sen embeds it to manage the list. The difference is a prop, because two
 * screens for one list is two screens to keep in step.
 *
 * Search is the only way to add one. Asking a person for coordinates would be asking them
 * to do the geocoder's job, and a place without its IANA timezone is a forecast an unknown
 * number of hours out (docs/12) — which is why the server drops any result that has none
 * rather than defaulting it.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated from "react-native-reanimated";

import { arrive, leave } from "@/lib/motion";
import {
  fromPlace,
  useDeleteLocation,
  useSaveLocation,
  useSearchPlaces,
  useSelectedLocation,
  type Place,
  type SavedLocation,
} from "@/lib/locations";
import { colors, radius, size, space, type } from "@/theme";

export function Places({
  onPicked,
}: {
  /** Called when a place is chosen. Absent in Sen, where choosing is not the point. */
  onPicked?: () => void;
}) {
  const { selected, select, saved } = useSelectedLocation();
  const save = useSaveLocation();
  const remove = useDeleteLocation();
  const [adding, setAdding] = useState(false);

  const keep = (place: Place) => {
    const location = fromPlace(place);
    save(location);
    select(location.id);
    setAdding(false);
    onPicked?.();
  };

  return (
    <View style={styles.wrap}>
      {saved.length === 0 ? (
        <Text style={styles.note}>
          Kayıtlı yerin yok. Uygulama şimdilik {selected.label} için çalışıyor; buradan
          kendi yerini eklersen ona geçer.
        </Text>
      ) : (
        saved.map((place) => (
          <Row
            key={place.id}
            place={place}
            active={place.id === selected.id}
            onSelect={() => {
              select(place.id);
              onPicked?.();
            }}
            onDelete={() => remove(place.id)}
          />
        ))
      )}

      {adding ? (
        <Animated.View entering={arrive()} exiting={leave()}>
          <Search onPick={keep} onCancel={() => setAdding(false)} />
        </Animated.View>
      ) : (
        <Pressable
          onPress={() => setAdding(true)}
          style={styles.add}
          accessibilityRole="button"
        >
          <Text style={styles.addText}>Yer ekle</Text>
        </Pressable>
      )}
    </View>
  );
}

function Row({
  place,
  active,
  onSelect,
  onDelete,
}: {
  place: SavedLocation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View style={[styles.row, active && styles.rowActive]}>
      <Pressable style={styles.rowMain} onPress={onSelect} accessibilityRole="button">
        <Text style={[styles.label, active && styles.labelActive]}>{place.label}</Text>
        <Text style={styles.zone}>{place.timezone}</Text>
      </Pressable>

      {confirming ? (
        <View style={styles.confirm}>
          <Pressable onPress={onDelete} hitSlop={6} accessibilityRole="button">
            <Text style={styles.destructive}>Sil</Text>
          </Pressable>
          <Pressable
            onPress={() => setConfirming(false)}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.quiet}>Vazgeç</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setConfirming(true)}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={styles.quiet}>Sil</Text>
        </Pressable>
      )}
    </View>
  );
}

function Search({
  onPick,
  onCancel,
}: {
  onPick: (place: Place) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, isFetching, isError } = useSearchPlaces(query);

  return (
    <View style={styles.search}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Şehir veya semt"
        placeholderTextColor={colors.inkDim}
        style={styles.input}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
      />

      {isError ? (
        <Text style={styles.failure}>
          Yer araması şu an çalışmıyor. Sunucuya ulaşılabiliyor mu, kontrol et.
        </Text>
      ) : isFetching ? (
        <ActivityIndicator color={colors.burnHi} size="small" style={styles.spinner} />
      ) : (
        (data ?? []).map((place) => (
          <Pressable
            // The name alone is not unique — "Beşiktaş" is three different places — so the
            // coordinates are part of what makes a row itself.
            key={`${place.name}-${place.latitude}-${place.longitude}`}
            onPress={() => onPick(place)}
            style={styles.result}
            accessibilityRole="button"
          >
            <Text style={styles.resultName}>{place.name}</Text>
            <Text style={styles.resultWhere}>{place.country ?? place.timezone}</Text>
          </Pressable>
        ))
      )}

      <Pressable onPress={onCancel} style={styles.cancel} accessibilityRole="button">
        <Text style={styles.quiet}>Vazgeç</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  note: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.ink2 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  rowActive: { borderColor: colors.burn, backgroundColor: colors.burnWash },
  rowMain: { flex: 1, gap: 1 },
  label: { ...type.body, fontSize: size.caption, color: colors.ink },
  labelActive: { color: colors.burnHi },
  zone: { ...type.data, fontSize: 10, color: colors.inkDim },

  confirm: { flexDirection: "row", gap: space.md, alignItems: "center" },
  destructive: { ...type.label, color: colors.ember },
  quiet: { ...type.label, color: colors.inkDim },

  add: {
    alignSelf: "flex-start",
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  addText: { ...type.label, color: colors.ink2 },

  search: { gap: space.xs, marginTop: space.sm },
  input: {
    ...type.body,
    fontSize: size.caption,
    color: colors.ink,
    backgroundColor: colors.ground2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  spinner: { paddingVertical: space.md },
  failure: { ...type.body, fontSize: 12, lineHeight: 17, color: colors.ember },
  result: {
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ruleSoft,
  },
  resultName: { ...type.body, fontSize: size.caption, color: colors.ink },
  resultWhere: { ...type.data, fontSize: 10, color: colors.inkDim },
  cancel: { alignSelf: "flex-start", paddingVertical: space.sm },
});
