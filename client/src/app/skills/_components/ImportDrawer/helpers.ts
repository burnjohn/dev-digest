import type { CommunitySkill } from "@devdigest/shared";

/** Unique language facets present in a community-skill result set. */
export function communityLangs(items: CommunitySkill[]): string[] {
  return Array.from(new Set(items.map((c) => c.lang)));
}

/** Filter community results by the active language facet (null = all). */
export function filterByLang(items: CommunitySkill[], lang: string | null): CommunitySkill[] {
  return items.filter((c) => (lang ? c.lang === lang : true));
}
