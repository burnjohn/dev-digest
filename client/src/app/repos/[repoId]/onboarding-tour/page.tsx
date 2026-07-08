/* /repos/:repoId/onboarding-tour — Onboarding Tour page.
   Read-only 5-section guided tour (architecture · critical paths · how to
   run · guided reading path · first tasks), generated once and re-generated
   on demand via the "Regenerate" action.

   Server Component shell — awaits `params` per Next.js 15 async-params
   convention, then hands `repoId` to the client view. Mirrors
   repos/[repoId]/context/page.tsx exactly (client/insights.md 2026-07-03). */

import { OnboardingTourView } from "./_components/OnboardingTourView";

export default async function OnboardingTourPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <OnboardingTourView repoId={repoId} />;
}
