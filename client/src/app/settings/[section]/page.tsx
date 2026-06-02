import { SettingsView } from "./_components/SettingsView";

/* Route: /settings/:section. Thin route entry — the view, its section panels,
   styles, constants and i18n are colocated under _components/SettingsView
   (Plugins panel lives under _components/PluginsSection). */
export default function SettingsPage() {
  return <SettingsView />;
}
