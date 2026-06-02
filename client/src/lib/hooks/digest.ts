/* hooks/digest.ts — A6 Weekly Digest (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Digest } from "@devdigest/shared";

export function useDigests() {
  return useQuery({
    queryKey: ["digests"],
    queryFn: () => api.get<Digest[]>("/digest"),
  });
}

export function useRunDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Digest>("/digest/run", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["digests"] }),
  });
}
