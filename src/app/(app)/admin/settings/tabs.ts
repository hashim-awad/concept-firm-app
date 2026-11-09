// Settings is split into tabs so each area is easy to find. The first tab is the default.
export const SETTINGS_TABS = [
  ["leads", "Leads and quotes"],
  ["letters", "Letters and signing"],
  ["tax", "Tax rules"],
  ["data", "Data and retention"],
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

export function settingsTab(v: unknown): SettingsTab {
  return SETTINGS_TABS.find(([k]) => k === v)?.[0] ?? "leads";
}

export const settingsPage = (tab: SettingsTab) => `/admin/settings?tab=${tab}`;
