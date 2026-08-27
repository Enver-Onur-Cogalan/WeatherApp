import { Note, Screen } from "@/components/screen";

/**
 * Sor — for anything the main screen does not already answer.
 *
 * Deliberately not the front door: most questions are answered deterministically by İz
 * in milliseconds, and a permanent question box would send them all to the model
 * instead (ADR-0014).
 */
export default function AskScreen() {
  return (
    <Screen eyebrow="Yerel" title="Sor">
      <Note>
        Açık uçlu sorular ve akan cevap kartı buraya gelecek. Model cihazda çalışıyor;
        soru hiçbir yere gitmiyor.
      </Note>
    </Screen>
  );
}
