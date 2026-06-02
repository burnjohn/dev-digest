/* hooks/plugins.ts — A6 plugin export/import (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PluginBundle, PluginImportResult, InstalledPlugin } from "@devdigest/shared";

export function useInstalledPlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => api.get<InstalledPlugin[]>("/plugins"),
  });
}

export function useExportPlugin() {
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; agent_ids?: string[] }) =>
      api.post<PluginBundle>("/plugins/export", body),
  });
}

export function useImportPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bundle: PluginBundle) => api.post<PluginImportResult>("/plugins/import", { bundle }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plugins"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
