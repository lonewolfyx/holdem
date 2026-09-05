import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-30',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  components: [
    { path: '~/components/ui', ignore: ['**/index.ts'] },
    '~/components',
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  app: {
    head: {
      title: '德州扑克 · Holdem',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: '3-10 人在线德州扑克' },
      ],
      link: [
        {
          rel: 'icon',
          href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>♠️</text></svg>',
        },
      ],
    },
  },
})
