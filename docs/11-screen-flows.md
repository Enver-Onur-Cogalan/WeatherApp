# 11 — Screen Flows

The navigation graph, what each screen holds, and how a person gets into the app from
outside it. The visual language for all of this is [doc 10](./10-design-language.md).

## The graph

```
first launch ──► Onboarding ──┐
                              │
cold start ───────────────────┤
widget tap ───────────────────┤
notification ─────────────────┤
                              ▼
                        ┌───────────┐
                        │    İz     │  ◄── the planner's output lives here
                        └─────┬─────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ┌─────────┐          ┌───────────┐         ┌──────────┐
   │   Sor   │          │  Konum    │         │   Sen    │
   │         │          │  seçici   │         └────┬─────┘
   └─────────┘          └───────────┘              │
                                        ┌──────────┼──────────┐
                                        ▼          ▼          ▼
                                   Profiller  Asistan   Hesap · Görünüm
                                                        Bildirimler · Veri
```

Three tabs, and everything else is pushed on top of one of them. There is no fourth level.

## Entry points

The app is entered from outside more often than it is opened cold, so the routes in
matter as much as the screens.

| Entry | Lands on | Carrying |
|---|---|---|
| Cold start | İz | Last active location and profile, rendered from SQLite before any network call |
| Widget tap | İz | The day the widget was showing |
| Rain notification | İz | Scrubbed to the hour the alert is about |
| Deep link | Any tab | `weatherapp://trace?loc=…&day=…&activity=…` |

Because of the last three, the İz screen takes **location, day, hour and activity as
parameters**. It is not allowed to have hidden state that a deep link cannot reach — a
notification that opens the app to the wrong hour is worse than no notification.

## Onboarding

Four steps, and every one of them can be skipped or fails soft.

```
1  Karşılama      One sentence: what this does that a weather app does not.
                  → "Başla"

2  Konum          Permission, with the reason stated before the system dialog.
                  → Denied or "Şimdi değil" continues to a city search.
                     The app is fully usable without location permission.

3  Profil         "Ne yapmayı seviyorsun?" — free text.
                     "Sabahları koşarım, 26 derecenin üstünde çıkmam, rüzgâr sevmem"
                  → ActivityProfile extracted, shown as editable fields, confirmed.
                  → "Kendim ayarlayayım" is always visible, and is the whole path
                     when the assistant is unreachable.

4  Hesap          Kayıt ol · Giriş yap · Misafir devam et
```

**Step 3 is the product's first impression**, and the only place the model appears before
a user has asked it anything. Two rules hold it together:

- **The extraction is confirmed, never silently saved.** A misread profile would poison
  every plan afterwards, invisibly.
- **The assistant is not a dependency.** If Ollama is unreachable the free-text field is
  replaced by the manual form with a one-line explanation. Onboarding cannot be the one
  place the app hard-requires a model.

## İz

The main screen. Top to bottom:

```
┌──────────────────────────────────┐
│ İstanbul  ⌄            14 dk önce│  location switcher · freshness
│                                  │
│ CUMARTESİ                        │  verdict — a span, not a number
│ 06:00–11:00                      │
│ Koşu için haftanın en iyisi.     │
│                                  │
│ ╭──────────────────────────────╮ │
│ │  the trace, burns, scrubber  │ │  drag to scrub
│ ╰──────────────────────────────╯ │
│ [ 24 saat │ 7 gün ]              │  time span
│                                  │
│ 21.7°  10 km/h  %0  UV 3         │  readout at the scrubbed hour
│                                  │
│ ○ Koşu  ○ Bisiklet  ○ Piknik  ⋯  │  activity — retraces on change
│                                  │
│ BU HAFTA                         │
│ Cmt 06:00–11:00           ▓▓▓▓   │  ranked windows
│ Paz 06:00–11:00           ▓▓▓    │  → tap scrubs the trace to it
│ Pzt 06:00–12:00           ▓▓     │
└──────────────────────────────────┘
```

Interactions, and what each one is not:

- **Horizontal drag** scrubs. **Vertical drag** scrolls the page. These never compete
  because the trace owns horizontal and the page owns vertical.
- **Time span is a segmented control**, not a pinch. Pinch-to-zoom is undiscoverable and
  would fight the page scroll; a two-state toggle costs one row and is obvious.
- **Activity chips** show the four most-used profiles; `⋯` opens the full list in a sheet.
  Changing activity morphs the trace — this is the demonstration, so it is one tap away
  and never behind a menu.
- **Tapping a ranked window** scrubs the trace to it rather than opening a detail screen.
  The trace already shows everything a detail screen would.

### When there is nothing to show

| Situation | The screen |
|---|---|
| No windows clear the profile | Names the constraint that eliminated the most hours, and offers to relax it |
| Data is stale | Trace desaturates, timestamp stays visible, a retry control appears |
| No profile yet | The trace plots plain comfort; a single prompt invites creating a profile |
| Location permission denied | Header opens the city search instead of "current location" |

## Sor

For anything the main screen does not answer. Deliberately not the front door — see
[ADR-0014](./adr/ADR-0014-planner-on-main-screen.md).

```
┌──────────────────────────────────┐
│ Sor                       yerel  │  where the model is running
│                                  │
│           Hafta sonu piknik      │
│           yapmayı düşünüyoruz    │  the question
│                                  │
│ ┌ UYGUN ──────────────────────┐  │
│ │ PAZAR                       │  │  structured answer card
│ │ 11:00–16:00                 │  │
│ │ Sıcaklık 24–27°, rüzgâr     │  │  streams as it writes
│ │ sakin, yağış beklenmiyor▌   │  │
│ │ ─────────────────────────── │  │
│ │ UV 13:00–15:00 arası 8'e    │  │  warnings in ember
│ │ çıkıyor — gölge planla.     │  │
│ └─────────────────────────────┘  │
│ 3 araç çağrısı · 1.9 sn · cihazda│  provenance
│                                  │
│ [ Bir şey sor              ]     │
└──────────────────────────────────┘
```

- **The answer is a card, not a paragraph.** Verdict, span, reason and warnings are
  separate fields from the schema, rendered as components.
- **Provenance is always shown** — how many tools ran, how long it took, and that it
  happened on the device. A local-only assistant should say so.
- **History is kept for the session and the last twenty exchanges**, stored locally and
  never synced. Enough to scroll back to yesterday's answer; not enough to become a chat
  app with a retention policy.
- **Assistant unreachable**: the input is disabled with the reason and a link to
  Sen → Asistan. The rest of the app is untouched.

## Sen

| Row | Contains |
|---|---|
| **Profiller** | List, create, edit, delete. Editing offers the same free-text path as onboarding |
| **Konumlar** | Saved places, reorder, add by search, current-location toggle |
| **Bildirimler** | Rain alerts and window alerts, per profile, with quiet hours |
| **Asistan** | Reachability, model name, endpoint, atmosphere quality tier |
| **Görünüm** | Units, language, theme |
| **Hesap** | Sign in / out, or upgrade a guest account |
| **Veri ve gizlilik** | Export everything, delete everything |

**Asistan** is a screen a hosted app would not have, and it is worth the space: this is
self-hosted software, so a person needs to see whether the model is reachable, which one
is answering, and where it lives. When something is wrong, this is where the app has
already told them to go.

## Guest to account

The one flow with real edge cases, so it is specified rather than left to be discovered:

```
Misafir  ──► Kayıt ol ──► profiles and locations upload
                      └─► ask history stays on the device
                      └─► nothing is duplicated if the account already has data:
                            same-named profiles are offered as a merge, not silently
                            overwritten in either direction
```

Ask history does not migrate because it is ephemeral by design. Profiles and locations do,
because losing them is the one thing that would make signing up feel like a punishment.

## Decisions recorded here

| Decision | Instead of | Why |
|---|---|---|
| Three tabs | Four or more | Everything else is one push deep. A settings tab that is really a menu of menus is a sign the information architecture failed |
| Segmented time span | Pinch to zoom | Discoverable, and no gesture conflict with page scroll |
| Ranked window taps scrub | Opening a detail screen | The trace is the detail screen |
| Ask history local, capped | Full synced chat history | Consistent with the privacy stance, and avoids inheriting chat-app expectations |
| Deep-linkable İz | Screen-local state | A notification must be able to open the exact hour it is about |

## Still open

- **Transitions.** Tab changes, sheet presentation, and the shared element between a
  ranked window and the trace are undesigned.
- **Widget layout.** The trace may not fit at widget size; a reduced form is needed, and
  it must still deep-link to the right day.
- **Icon set.** The instrument direction points at plotted marks rather than pictograms,
  but nothing has been drawn.
- **First-run without any network at all.** Onboarding currently assumes a forecast can be
  fetched at least once. What the app shows before it ever has data is unspecified.
