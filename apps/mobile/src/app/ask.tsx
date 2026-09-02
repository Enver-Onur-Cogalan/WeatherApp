import { AskScreen } from "@/screens/ask";

/**
 * Sor.
 *
 * Route files hold route concerns only. This one will read a prefilled question from
 * the URL once deep links land — tapping a window on İz and asking about it should
 * arrive here with the question already written (docs/11).
 */
export default function AskRoute() {
  return <AskScreen />;
}
