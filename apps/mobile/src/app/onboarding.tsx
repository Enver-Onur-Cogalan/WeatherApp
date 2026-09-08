import { OnboardingScreen } from "@/screens/onboarding";

/**
 * The tour, and later the way back to it.
 *
 * Route files hold route concerns only. This one is reached twice: once automatically
 * after the gate has been answered, and once from Sen by someone who wants to read it
 * again.
 */
export default function OnboardingRoute() {
  return <OnboardingScreen />;
}
