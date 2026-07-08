/* /repos/:repoId/context — Project Context page.
   Browse the repository's context documents (path · category · token count ·
   used-by count · preview) plus root context-folder configuration. Read-only:
   attach/detach lives only in the agent/skill editors (AC-8).

   Server Component shell — awaits `params` per Next.js 15 async-params
   convention, then hands `repoId` to the client view. */

import { ContextDocsView } from "./_components/ContextDocsView";

export default async function ContextPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ContextDocsView repoId={repoId} />;
}
