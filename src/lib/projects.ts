import { getCollection, type CollectionEntry } from "astro:content";

type Filter = (entry: CollectionEntry<"projects">) => boolean;

const startYear = (period: string) => Number(period.match(/\d{4}/)?.[0] ?? 0);

/** Projects ordered featured-first, then newest start year, then name. */
export async function getProjects(filter: Filter = () => true) {
  const entries = await getCollection("projects", filter);
  return entries.sort(
    (a, b) =>
      Number(b.data.featured) - Number(a.data.featured) ||
      startYear(b.data.period) - startYear(a.data.period) ||
      a.data.name.localeCompare(b.data.name),
  );
}
