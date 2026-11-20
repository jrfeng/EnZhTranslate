# Android 支持方案

> 状态：讨论稿（未开工）
> 版本：v1
> 日期：2026-11-20
> 适用代码基线：v0.8.0（`main` = `dev` = `0cee8ce`）

## 1. 目标与范围

| 项 | 决定 |
|---|---|
| 平台 | 仅 Android |
| 最低版本 | Android 8.0（API 26） |
| 分发 | 本地出 APK 自用，不上架；**CI 不构建 APK** |
| 代码组织 | 与桌面共用同一仓库、同一前端、同一套 UI |
| 网络 | 支持局域网 / 自定义接口地址（含 `http://`） |
| 图片输入 | 相册选图 + 相机拍照 |
| 交互基线 | 现有 `≤480` 手机布局即为移动端 UI |

明确不做：iOS、应用商店上架、CI 出 Android 包、后台常驻服务、桌面端 UI 改动。

## 2. 架构思路

```
同一份 dist/ 前端
        │
        ├── 桌面（Windows）：自定义标题栏 + 鼠标交互 + arboard 剪贴板（含 HTML）
        └── Android：隐藏标题栏 + 触摸/安全区 + 原生图片插件
        │
        └── Rust 公共层：translate / models / balance / ocr（不变）
```

- UI 不分叉：只增加 `html[data-platform="android"]` 下的少量样式与 JS 分支
- Rust 按平台分层：`#[cfg(desktop)]` / `#[cfg(mobile)]`，桌面逻辑零改动
- 平台差异收敛在三个函数：`readClipboard`、`pickImage`、`windowControls`

## 3. 关键决策

| # | 议题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 相册选图 | `ActivityResultContracts.PickVisualMedia`（Photo Picker） | 无需权限；Android 8 自动回退 `ACTION_OPEN_DOCUMENT` |
| 2 | 拍照 | `ActivityResultContracts.TakePicture` + FileProvider | 不需要 `CAMERA` 运行时权限，系统相机画质最好 |
| 3 | 图片来源 UI | 点图片按钮弹三选一面板：从相册选择 / 拍照 / 取消 | 一步进入，不常驻占位 |
| 4 | 临时文件 | 写入 `cacheDir`，OCR 成功或关闭校验弹窗后删除 | 避免占存储 |
| 5 | 剪贴板 | Rust 侧统一使用 `tauri-plugin-clipboard-manager`；桌面「读 HTML」额外走 arboard | 保留桌面富文本粘贴；移动端不额外处理权限 |
| 6 | 自定义接口 | Manifest 开 `usesCleartextTraffic`（或 network-security-config） | 局域网 `http://` 必需 |
| 7 | 窗口 `visible:false` | 先沿用；若 Android 首屏空白，用 `tauri.android.conf.json` 覆盖为 `true` | 待 P0 实测 |
| 8 | `gen/android` | 入库（只忽略 `.gradle/`、`build/`、`local.properties`） | 相机插件与 Manifest 改动都在其中 |

## 4. 文件级改动清单

### 4.1 新增

| 路径 | 作用 |
|---|---|
| `src-tauri/tauri.android.conf.json` | Android 平台配置覆盖（minSdk 26、窗口可见性） |
| `src-tauri/src/mobile.rs` | 移动端命令与插件桥接（图片读取等） |
| `src-tauri/gen/android/app/src/main/java/.../ImageSourcePlugin.kt` | 相册 / 拍照插件（Kotlin） |
| `src-tauri/gen/android/app/src/main/res/xml/file_paths.xml` | FileProvider 路径声明 |
| `debug/run-android-debug.cmd` | 一键 `tauri android dev` |
| `docs/android-build.md` | 本地构建 / 签名步骤 |

### 4.2 修改

| 路径 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | `reqwest` → `rustls-tls`；新增 `tauri-plugin-clipboard-manager`；`arboard` 移到 `cfg(desktop)` |
| `src-tauri/src/lib.rs` | 插件注册；`clipboard_read/write` 分平台；`app_ready` 分平台；`single_instance` 加 `cfg(desktop)`；注册 mobile 插件 |
| `src-tauri/tauri.conf.json` | `bundle.android.minSdkVersion: 26`（`targets` 保持 nsis 不变） |
| `src-tauri/capabilities/default.json` | 补充移动端需要的 core 权限（图片插件走 Rust，无需 JS 权限） |
| `src-tauri/gen/android/.../AndroidManifest.xml` | cleartext；FileProvider；`adjustResize`；必要的 `<queries>` |
| `src/app.js` | 平台识别；标题栏隐藏；图片入口分支；图片压缩；剪贴板调用保持命令不变 |
| `src/app.css` | `data-platform=android` 下的安全区、`100dvh`、字体栈补 `Noto Sans CJK SC` |
| `src/index.html` | 图片来源面板结构（默认隐藏） |
| `.gitignore` | 调整 `src-tauri/gen/` 规则，保留 android 源码 |
| `README.md` | 增加 Android 构建一节 |

## 5. 依赖变更

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-clipboard-manager = "2"
reqwest = { version = "0.12", default-features = false, features = ["json", "multipart", "rustls-tls"] }

[target.'cfg(desktop)'.dependencies]
arboard = "3"
```

- 不引入任何 npm 包：剪贴板在 Rust 侧调用，前端代码不变
- 图片插件同样通过 `invoke('plugin:image-source|pickImage')` 调用

## 6. 关键实现草案

### 6.1 剪贴板（Rust）

```rust
#[tauri::command]
fn clipboard_write(app: tauri::AppHandle, text: String) -> Value {
    match app.clipboard().write_text(text) {
        Ok(_) => json!({ "ok": true }),
        Err(error) => error_json("CLIPBOARD", error.to_string()),
    }
}

#[tauri::command]
fn clipboard_read(app: tauri::AppHandle) -> Value {
    // 移动端：纯文本；桌面端：优先用 arboard 取 HTML（保留富文本 → Markdown 粘贴）
    let text = app.clipboard().read_text().unwrap_or_default();
    #[cfg(desktop)]
    {
        /* arboard: 若存在 html 则一并返回 */
    }
    json!({ "ok": true, "text": text, "html": html })
}
```

### 6.2 相机 / 相册插件（Kotlin 概要）

```kotlin
class ImageSourcePlugin : Plugin() {
    @Command fun pickImage(invoke: Invoke) { /* PickVisualMedia → content:// 转 cacheDir 文件 */ }
    @Command fun takePhoto(invoke: Invoke) { /* TakePicture + FileProvider → cacheDir 文件 */ }
}
```

- 返回 `{ path, name, mime }`；Rust 读文件转 base64 data URL 后交给前端 `handleImageFile`
- 用户取消返回 `{ cancelled: true }`，前端静默处理

### 6.3 前端图片入口

```js
if (isAndroid) showImageSourceSheet()   // 相册 / 拍照 / 取消
else el['image-input'].click()          // 桌面维持现状
```

拍照后统一走：`dataUrl → canvas 压缩（长边 ≤1600、JPEG 0.85）→ handleImageFile`；EXIF 方向用
`createImageBitmap(blob, { imageOrientation: 'from-image' })` 修正。

### 6.4 AndroidManifest 关键项

```xml
<application android:usesCleartextTraffic="true" ...>
  <provider
      android:name="androidx.core.content.FileProvider"
      android:authorities="${applicationId}.fileprovider"
      android:exported="false"
      android:grantUriPermissions="true">
    <meta-data android:name="android.support.FILE_PROVIDER_PATHS"
               android:resource="@xml/file_paths" />
  </provider>

  <activity android:name=".MainActivity"
            android:windowSoftInputMode="adjustResize" />
</application>
```

## 7. 分阶段实施与验收

- [ ] **P0 编译跑通**（2 天）
  - 环境：JDK 17、`ANDROID_HOME`、NDK 27/28、`rustup target add` 三平台目标
  - `npx tauri android init` 生成工程
  - rustls、平台分层、隐藏标题栏
  - 验收：真机安装启动、能完成一次翻译、无白屏

- [ ] **P1 移动端可用**（2.5 天）
  - 安全区、`100dvh`、软键盘、返回键
  - 图片压缩、字体栈补充、长按防系统菜单
  - 验收：竖屏操作不被遮挡；键盘不压底部操作条；返回键行为正确

- [ ] **P2 图片双入口**（2 天）
  - Kotlin 插件（相册 + 拍照）、FileProvider、临时文件清理
  - 验收：相册 / 拍照都能走通 OCR → 翻译；取消不报错；EXIF 方向正确

- [ ] **P3 网络与剪贴板**（1.5 天）
  - cleartext、局域网自定义地址、剪贴板迁移、桌面回归
  - 验收：局域网 http 可用；桌面复制与富文本粘贴不退化

- [ ] **P4 打包打磨**（2 天）
  - 图标 / 启动图、状态栏配色、签名、文档、脚本
  - 验收：产出可安装 APK；图标与启动图正常

- [ ] **P5 回归**（1–2 天）
  - 按第 9 节测试矩阵执行

合计约 11 天。

## 8. 提交序列

1. `chore: switch reqwest to rustls and gate desktop-only deps`
2. `chore: add android project scaffold (minSdk 26) and gitignore rules`
3. `feat(mobile): hide desktop titlebar and respect safe areas`
4. `feat: compress images before OCR`
5. `feat(mobile): image source plugin for gallery and camera`
6. `feat: unify clipboard through clipboard-manager plugin`
7. `feat(mobile): allow cleartext http for custom endpoints`
8. `chore: android icons, signing docs and debug script`

## 9. 测试矩阵

| 类别 | 用例 |
|---|---|
| 机型 | Android 8 / 10 / 12 / 14 真机（至少 8 和 14） |
| 输入 | 键盘弹起、中文拼音组字、长按选词 |
| 布局 | 竖屏 / 横屏 / 刘海 / 手势导航 / 折叠屏 |
| 图片 | 相册选图、拍照、超大图、取消、EXIF 旋转 |
| 网络 | 官方接口、局域网 http、超时、断网 |
| 剪贴板 | 复制译文、从浏览器粘贴（移动纯文本、桌面保留 Markdown） |
| 弹窗 | 全屏抽屉开合、返回键、遮罩点击 |
| 主题 | 浅色 / 深色 / 跟随系统 |

## 10. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| JDK 25 与 Gradle 不兼容 | 构建失败 | 统一 JDK 17，固定 `JAVA_HOME` |
| `visible:false` 在 Android 白屏 | 首批跑不起来 | `tauri.android.conf.json` 覆盖为 `true` |
| `gen/android` 入库管理 | 插件丢失 | 只忽略构建产物，源码入库 |
| Photo Picker 旧机型回退差异 | 选图异常 | Android 8 实测；必要时强制 `ACTION_OPEN_DOCUMENT` |
| 大图 OCR 内存 / 超时 | 崩溃或超时 | 前端压缩 + 限制上传体积 |
| `rustls` 不支持自签名 https | 局域网 https 不可用 | 文档注明使用 http；后续可加显式选项 |
| Tauri 移动端 API 变动 | 返工 | 锁定 tauri 小版本，升级单独验证 |

## 11. 待确认（默认按此执行）

| 项 | 默认 | 备选 |
|---|---|---|
| 剪贴板 | 混合：Rust 插件 + 桌面 arboard 读 HTML | 彻底插件化、舍弃富文本粘贴 |
| 图片来源面板 | 三选一（相册 / 拍照 / 取消） | 底部两个并排按钮 |
| 拍照临时文件 | OCR 成功或关弹窗即删 | 保留在缓存 |
| `gen/android` | 入库（忽略产物） | 不入库、脚本重建 |
