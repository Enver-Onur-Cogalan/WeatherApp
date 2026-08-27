import { Note, Screen } from "@/components/screen";

/**
 * Sen — profiles, locations, notifications, the assistant, appearance, account, data.
 *
 * The assistant row is a screen a hosted app would not have: this is self-hosted
 * software, so a person needs to see whether the model is reachable and which one is
 * answering (docs/11).
 */
export default function YouScreen() {
  return (
    <Screen eyebrow="Ayarlar" title="Sen">
      <Note>
        Profiller, konumlar, bildirimler, asistan durumu ve hesap buraya gelecek.
      </Note>
    </Screen>
  );
}
