import { build } from 'esbuild'
import { cp, copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')
const out = join(root, 'dist')

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

await build({
  entryPoints: [join(src, 'main.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'chrome110',
  charset: 'utf8',
  outfile: join(out, 'app.js'),
  logLevel: 'info',
})

for (const file of ['index.html', 'app.css']) {
  await copyFile(join(src, file), join(out, file))
}

// 静态图片资源（空译文区的水印等）
await cp(join(src, 'assets'), join(out, 'assets'), { recursive: true })

// Web Awesome 的主题 CSS 带相对 @import，整目录拷过去保持结构
await cp(join(root, 'node_modules/@awesome.me/webawesome/dist/styles'), join(out, 'styles'), {
  recursive: true,
})

console.log('dist/ 已生成')
