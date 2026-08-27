import { Note, Screen } from "@/components/screen";

/**
 * İz — the main screen, and the planner's output.
 *
 * Takes location, day, hour and activity as parameters: a widget tap or a rain
 * notification must be able to open the exact hour it is about, so this screen is not
 * allowed hidden state a deep link cannot reach (docs/11).
 */
export default function TraceScreen() {
  return (
    <Screen eyebrow="İstanbul" title="İz">
      <Note>
        Konfor izi, sıralı pencereler ve saatlik okuma buraya gelecek. Skorlama motoru
        hazır ve test edilmiş durumda — bu ekran onun çıktısını çiziyor.
      </Note>
    </Screen>
  );
}
