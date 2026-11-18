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

type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  devServer,
}: ConfigOptions = {}): Configuration => ({
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
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
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
      __API_ORIGIN__: JSON.stringify(apiOrigin),
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
      },
    },
  },
  // 按传输体积衡量：入口 JS + CSS 约 617 KiB，gzip 后约 186 KiB。
  // 512 KiB 是 webpack 早期针对未压缩资源的默认值，上浮入口阈值避免误报，
  // 但保留告警，入口明显膨胀时仍会提示。
  // dev 产物未压缩，体积告警只会干扰启动输出；生产构建保留提示
  // 阈值按未压缩体积设置：表情数据已单独拆包，主包 gzip 后约 180 KiB
  performance: {
    hints: dev ? false : 'warning',
    maxAssetSize: 600 * 1024,
    maxEntrypointSize: 650 * 1024,
  },
  devServer: { port: DEV_PORT, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
