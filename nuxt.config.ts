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
    // tailwindcss 的 vite 插件类型与 Nuxt 内置 vite 类型版本不一致，此处需断言
    plugins: [tailwindcss()] as any,
  },
  nitro: {
    // better-sqlite3 是原生模块：必须外置出打包产物，由运行时从 node_modules 加载，
    // 否则 rollup 打包 .node 二进制会导致构建/运行失败
    externals: {
      external: ['better-sqlite3'],
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
