import { WelcomeScreen } from "@/screens/welcome";

/**
 * The gate, and later the way back to it.
 *
 * Route files hold route concerns only. This one is reached twice: once before the app
 * has been entered at all, and once from Sen when a guest decides they want an account.
 */
export default function WelcomeRoute() {
  return <WelcomeScreen />;
}
