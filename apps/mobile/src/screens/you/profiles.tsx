/**
 * Profiles, on the settings screen.
 *
 * Every control here names a thing a person controls — a *wind limit*, not a
 * `wind_max_kmh` constraint (docs/10). The engine's field names never reach the screen.
 *
 * Editing is a stepper rather than a slider. These are integers with meaning: 15 km/h is
 * a decision, and a slider that lands on 14 or 16 because of where a thumb happened to
 * stop makes the person fight the control instead of expressing the limit. Steppers also
 * work with one thumb on a phone held in one hand, which is when this app is used.
 *
 * Saving writes the whole record, id and all, because the client owns the id (ADR-0015).
 * A save that loses to a newer version comes back 409 and the list is refetched — the
 * screen shows what the server holds rather than what this device wished for.
 */

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  BUILT_IN,
  useDeleteProfile,
  useProfiles,
  useSaveProfile,
  type SavedProfile,
} from "@/lib/profiles";
import { type ActivityProfile } from "@/lib/plan";
import { uuidv7 } from "@/lib/uuid";
import { colors, radius, size, space, type } from "@/theme";

/** What each limit is called, and how far a step moves it. */
const LIMITS = [
  { key: "temp_min", label: "En düşük sıcaklık", unit: "°C", step: 1, min: -40, max: 50 },
  { key: "temp_max", label: "En yüksek sıcaklık", unit: "°C", step: 1, min: -40, max: 50 },
  { key: "wind_max_kmh", label: "Rüzgâr limiti", unit: "km/sa", step: 1, min: 0, max: 150 },
  { key: "precip_max_pct", label: "Yağış ihtimali", unit: "%", step: 5, min: 0, max: 100 },
] as const;

type LimitKey = (typeof LIMITS)[number]["key"];

export function Profiles() {
  const { data, isPending, isError } = useProfiles();
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const [editing, setEditing] = useState<SavedProfile | null>(null);

  if (editing !== null) {
    return (
      <Editor
        profile={editing}
        busy={save.isPending}
        onCancel={() => setEditing(null)}
        onSave={(next) => {
          save.mutate(next, { onSuccess: () => setEditing(null) });
        }}
      />
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Profiller</Text>

      {isPending ? (
        <Text style={styles.note}>Yükleniyor…</Text>
      ) : isError ? (
        <Text style={styles.failure}>Profiller alınamadı. Sen sekmesini yeniden aç.</Text>
      ) : data !== undefined && data.length > 0 ? (
        data.map((profile) => (
          <Row
            key={profile.id}
            profile={profile}
            onEdit={() => setEditing(profile)}
            onDelete={() => remove.mutate(profile.id)}
          />
        ))
      ) : (
        <Text style={styles.note}>
          Kayıtlı profilin yok. İz şimdilik hazır üç profille çalışıyor; buradan kendi
          profilini kaydedersen çipler ondan gelir.
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => setEditing(blank())}
          style={styles.action}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Yeni profil</Text>
        </Pressable>

        {data !== undefined && data.length === 0 ? (
          // Offered rather than done automatically. Seeding an account on first sign-in
          // would write data the person never created, in an account whose premise is
          // that it stores what they ask it to.
          <Pressable
            onPress={() => BUILT_IN.forEach((choice) => save.mutate(fromBuiltIn(choice)))}
            style={styles.action}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>Hazır üçünü kaydet</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Row({
  profile,
  onEdit,
  onDelete,
}: {
  profile: SavedProfile;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onEdit} accessibilityRole="button">
        <Text style={styles.rowName}>{profile.name}</Text>
        <Text style={styles.rowDetail}>{summarise(profile.constraints)}</Text>
      </Pressable>

      {confirming ? (
        // Two taps, in place. A destructive action needs a beat, and a system alert would
        // hand the one moment the app should feel like itself to the platform.
        <View style={styles.confirm}>
          <Pressable onPress={onDelete} hitSlop={6} accessibilityRole="button">
            <Text style={styles.destructive}>Sil</Text>
          </Pressable>
          <Pressable onPress={() => setConfirming(false)} hitSlop={6} accessibilityRole="button">
            <Text style={styles.quiet}>Vazgeç</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setConfirming(true)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.quiet}>Sil</Text>
        </Pressable>
      )}
    </View>
  );
}

function Editor({
  profile,
  busy,
  onSave,
  onCancel,
}: {
  profile: SavedProfile;
  busy: boolean;
  onSave: (next: SavedProfile) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(profile);

  const setLimit = (key: LimitKey, value: number) =>
    setDraft((current) => ({
      ...current,
      constraints: { ...current.constraints, [key]: value },
    }));

  // The one rule that relates two fields, checked here so the button can say why rather
  // than the server rejecting it with a 422.
  const impossible = draft.constraints.temp_min > draft.constraints.temp_max;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{profile.name || "Yeni profil"}</Text>

      {LIMITS.map((limit) => (
        <Stepper
          key={limit.key}
          label={limit.label}
          unit={limit.unit}
          value={draft.constraints[limit.key]}
          onChange={(value) =>
            setLimit(limit.key, Math.min(limit.max, Math.max(limit.min, value)))
          }
          step={limit.step}
        />
      ))}

      <Stepper
        label="Tercih ettiğin saatler — başlangıç"
        unit=":00"
        value={draft.constraints.preferred_hours[0]}
        step={1}
        onChange={(value) =>
          setDraft((current) => ({
            ...current,
            constraints: {
              ...current.constraints,
              preferred_hours: [
                Math.min(23, Math.max(0, value)),
                current.constraints.preferred_hours[1],
              ],
            },
          }))
        }
      />
      <Stepper
        label="Tercih ettiğin saatler — bitiş"
        unit=":00"
        value={draft.constraints.preferred_hours[1]}
        step={1}
        onChange={(value) =>
          setDraft((current) => ({
            ...current,
            constraints: {
              ...current.constraints,
              preferred_hours: [
                current.constraints.preferred_hours[0],
                Math.min(23, Math.max(0, value)),
              ],
            },
          }))
        }
      />

      {impossible ? (
        <Text style={styles.failure}>
          En düşük sıcaklık, en yüksekten büyük olamaz.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() =>
            onSave({ ...draft, updated_at: new Date().toISOString() })
          }
          disabled={busy || impossible}
          style={[styles.action, (busy || impossible) && styles.dim]}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>{busy ? "Kaydediliyor…" : "Kaydet"}</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionText}>Vazgeç</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stepper({
  label,
  unit,
  value,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null | undefined;
  step: number;
  onChange: (value: number) => void;
}) {
  const current = value ?? 0;

  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => onChange(current - step)}
          hitSlop={10}
          style={styles.step}
          accessibilityRole="button"
          accessibilityLabel={`${label} azalt`}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>
          {current}
          {unit}
        </Text>
        <Pressable
          onPress={() => onChange(current + step)}
          hitSlop={10}
          style={styles.step}
          accessibilityRole="button"
          accessibilityLabel={`${label} artır`}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** "5–26°C · 15 km/sa · %20 · 06–10" — the limits, in the order people say them. */
function summarise(constraints: ActivityProfile): string {
  const [from, to] = constraints.preferred_hours;
  const pad = (hour: number) => String(hour).padStart(2, "0");
  return [
    `${constraints.temp_min}–${constraints.temp_max}°C`,
    `${constraints.wind_max_kmh} km/sa`,
    `%${constraints.precip_max_pct}`,
    `${pad(from)}–${pad(to)}`,
  ].join(" · ");
}

function blank(): SavedProfile {
  const now = new Date().toISOString();
  return {
    // Generated here, not by the server (ADR-0015). v7, so ids sort by creation.
    id: uuidv7(),
    name: "Yeni profil",
    constraints: { ...BUILT_IN[0].constraints },
    created_at: now,
    updated_at: now,
  };
}

function fromBuiltIn(choice: (typeof BUILT_IN)[number]): SavedProfile {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    name: choice.label,
    constraints: choice.constraints,
    created_at: now,
    updated_at: now,
  };
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderLeftWidth: 2,
    borderLeftColor: colors.burn,
    padding: space.md,
    gap: space.sm,
  },
  label: { ...type.label, color: colors.burnHi },
  note: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.ink2 },
  failure: { ...type.body, fontSize: 12, lineHeight: 17, color: colors.ember },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ruleSoft,
  },
  rowMain: { flex: 1, gap: 2 },
  rowName: { ...type.body, fontSize: size.caption, color: colors.ink },
  rowDetail: { ...type.data, fontSize: 11, color: colors.inkDim },
  confirm: { flexDirection: "row", gap: space.md, alignItems: "center" },
  destructive: { ...type.label, color: colors.ember },
  quiet: { ...type.label, color: colors.inkDim },

  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.xs,
  },
  stepperLabel: { ...type.body, fontSize: size.caption, color: colors.ink2, flex: 1 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: space.sm },
  step: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  stepText: { ...type.data, fontSize: 17, color: colors.ink },
  stepperValue: {
    ...type.data,
    fontSize: size.caption,
    color: colors.burnHi,
    minWidth: 58,
    textAlign: "center",
  },

  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs, flexWrap: "wrap" },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  actionText: { ...type.label, color: colors.ink2 },
  dim: { opacity: 0.4 },
});
