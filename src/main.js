/**
 * 前端入口：注册 Web Awesome 组件，然后交给 app.js。
 * 这些 import 由 esbuild 打包成 dist/app.js。
 */

import '@awesome.me/webawesome/dist/components/button/button.js'
import '@awesome.me/webawesome/dist/components/dialog/dialog.js'
import '@awesome.me/webawesome/dist/components/input/input.js'
import '@awesome.me/webawesome/dist/components/option/option.js'
import '@awesome.me/webawesome/dist/components/select/select.js'
import '@awesome.me/webawesome/dist/components/tag/tag.js'

import './app.js'
