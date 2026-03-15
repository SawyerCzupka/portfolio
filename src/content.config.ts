import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: file('src/data/projects.json'),
  schema: z.object({
    name: z.string(),
    subtitle: z.string(),
    period: z.string(),
    url: z.string().url().nullable(),
    featured: z.boolean().default(false),
    teaser: z.string(),
    description: z.string(),
    highlights: z.array(z.string()),
    stack: z.array(z.string()),
    academic: z.boolean().default(false),
  }),
});

export const collections = { blog, projects };
