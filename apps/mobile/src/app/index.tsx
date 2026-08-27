import { TraceScreen } from "@/screens/trace";

/**
 * İz.
 *
 * Route files hold route concerns only. This one will read location, day, hour and
 * activity from the URL once deep links land — a rain notification has to be able to
 * open the exact hour it is about (docs/11).
 */
export default function TraceRoute() {
  return <TraceScreen />;
}
