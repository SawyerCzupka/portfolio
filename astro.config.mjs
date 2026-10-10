import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  site: 'https://sawyerczupka.com',
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'EB Garamond',
      cssVariable: '--font-eb-garamond',
      weights: [400, 500],
      styles: ['normal', 'italic'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Geist',
      cssVariable: '--font-geist',
      weights: ['300 700'],
    },
    {
      provider: fontProviders.google(),
      name: 'Geist Mono',
      cssVariable: '--font-geist-mono',
      weights: [400, 500],
    },
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
