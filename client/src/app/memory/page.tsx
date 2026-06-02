import { MemoryView } from "./_components/MemoryView";

/* Route: /memory (?scope, ?kind, ?q, ?freshness). Thin route entry — the view,
   its styles, constants, helpers and tests are colocated under
   _components/MemoryView. */
export default function MemoryPage() {
  return <MemoryView />;
}
