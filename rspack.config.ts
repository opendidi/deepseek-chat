import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

const dev = process.env.NODE_ENV !== 'production'
/** dev 端口：默认 8090；PORT=auto 让 dev server 自动挑空闲端口，PORT=8091 可手动避开冲突 */
const DEV_PORT: number | 'auto' =
  process.env.PORT === 'auto' ? 'auto' : Number(process.env.PORT) || 8090
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

/** sass-loader 先编译 SCSS，再交给 lightningcss 做目标浏览器降级；sass-embedded 会被自动选用 */
const sassLoader = { loader: 'sass-loader' }

type ConfigOptions = {
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置；模型 API 一律走同源 /api/deepseek 代理，上游地址由服务端 .env 决定 */
export const createConfig = ({ devServer }: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，产物可托管在任意子路径，不再绑定 /deepseek/
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.scss'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.scss$/, type: 'css/module', use: [cssLoader, sassLoader] },
      { test: /\.scss$/, exclude: /\.module\.scss$/, type: 'css', use: [cssLoader, sassLoader] },
      // 仍保留 .css 规则：第三方包（如 katex/dist/katex.min.css）直接提供编译后的 CSS
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.DefinePlugin({
      // 仅生产构建注册 Service Worker；开发服务器上始终直连
      __ENABLE_SW__: JSON.stringify(!dev),
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        { from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' },
        {
          from: path.resolve(root, 'public/manifest.webmanifest'),
          to: 'manifest.webmanifest',
          toType: 'file',
        },
        { from: path.resolve(root, 'public/sw.js'), to: 'sw.js', toType: 'file' },
        { from: path.resolve(root, 'public/icons'), to: 'static/icons' },
      ],
    }),
  ],
  optimization: {
    splitChunks: {
      cacheGroups: {
        // 表情全量数据（native.json 约 423 KiB）与组件逻辑分开缓存：
        // 组件代码更新不会让数据块失效，单块体积也回落到阈值以内
        emojiData: {
          test: /node_modules.@emoji-mart.data/,
          name: 'emoji-data',
          chunks: 'async',
          priority: 20,
          enforce: true,
        },
        // 每种语言一个动态 import 会产生 90+ 个极小 chunk，合并成一块共享异步包
        prismLanguages: {
          test: /node_modules.prismjs.components./,
          name: 'prism-languages',
          chunks: 'async',
          priority: 15,
          enforce: true,
        },
        // Mermaid 自带几十个异步依赖，合并后按体积再切成若干块，兼顾请求数与单块大小
        mermaidVendors: {
          test: /node_modules.(mermaid|d3|dagre|cytoscape|elkjs|khroma|dompurify|lodash-es|@mermaid-js)/,
          name: 'mermaid-vendors',
          chunks: 'async',
          priority: 10,
          maxSize: 350 * 1024,
        },
      },
    },
  },
  // 按传输体积衡量：入口 JS + CSS 约 660 KiB，gzip 后约 195 KiB。
  // 阈值随功能体量校准（当前主包 ~668 KiB / 入口合计 ~806 KiB，gzip 后约 190 KiB）；
  // 超过警戒线只提示不阻断，体积明显继续膨胀时再考虑进一步拆包；
  // 但保留告警，入口明显膨胀时仍会提示。
  // dev 产物未压缩，体积告警只会干扰启动输出；生产构建保留提示
  // 统计分区已按需加载，主包仍包含 i18n、设置项与本机账本采集入口
  // maxAssetSize 覆盖最大的懒加载分包（mermaid 12 vendors 约 1.4MiB，一次性加载不拆碎）
  performance: {
    hints: dev ? false : 'warning',
    maxAssetSize: 1.5 * 1024 * 1024,
    maxEntrypointSize: 900 * 1024,
  },
  devServer: { port: DEV_PORT, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(
  // 存储后端（server/，pnpm backend 启动）与页面同源时无需代理；开发模式下 /api 转给本机服务
  createConfig({
    devServer: {
      // 与 scripts/backend.mjs、devall.mjs 的 BACKEND_PORT 保持一致
      proxy: [{ context: '/api', target: `http://127.0.0.1:${process.env.BACKEND_PORT || '8000'}` }],
    },
  })
)
