import { getCollection } from "astro:content";

/** Experience entries, newest start date first. */
export async function getExperience() {
  const entries = await getCollection("experience");
  return entries
    .map((e) => ({ id: e.id, ...e.data }))
    .sort((a, b) => b.start.valueOf() - a.start.valueOf());
}
