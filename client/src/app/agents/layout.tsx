/* Server layout: pages in this segment are "use client" and cannot export
   metadata — this thin pass-through owns the tab title. */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
