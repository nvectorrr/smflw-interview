export type AppTab = "detect" | "activity" | "review" | "team";

export function getTab(url: URL): AppTab {
  const tab = url.searchParams.get("tab");
  if (
    tab === "detect" ||
    tab === "activity" ||
    tab === "review" ||
    tab === "team"
  )
    return tab;
  return /^\/join\/[^/]+\/?$/.test(url.pathname) ||
    url.searchParams.get("invite")
    ? "team"
    : "detect";
}

export function getTabUrl(current: URL, tab: AppTab): URL {
  const url = new URL(current);
  // Keep invitation parameters and Supabase's auth callback hash intact.
  url.searchParams.set("tab", tab);
  return url;
}
