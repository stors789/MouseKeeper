# Tauri 2 原生 App

MouseKeeper 的 React、业务服务、Dexie 数据库、备份格式和 CSV 规则由 Web/PWA 与 Tauri 共用。`src/platform/` 只承接运行时差异：系统文件选择/保存、原生 HTTP、PWA 注册和 Stronghold 凭据保险库；`src-tauri/` 保存 Rust 壳、权限与打包配置。

## 支持范围

| 目标 | 最低版本/要求 | 状态 |
|---|---|---|
| Web/PWA | 当前 Chrome/Edge；其他浏览器需实机验收 | 自动化构建与测试通过 |
| macOS | macOS 13.3+ | Rust 编译与无 bundle 构建可在 macOS 验证；签名/公证未配置 |
| Windows | Windows 10/11 + WebView2 | 工程与依赖已配置；需 Windows 主机验证 MSI/NSIS |
| Android | 当前 Android System WebView；Android Studio、SDK/NDK、JDK、Rust Android targets | 可初始化/构建；本机缺完整工具链，未做设备验证 |
| iPhone/iPad | iOS/iPadOS 16.4+；macOS + 完整 Xcode、CocoaPods、Rust iOS targets | Xcode 工程初始化成功；模拟器构建进入 Rust/Swift 编译后受 Xcode 27 beta SDK 选择兼容问题阻塞 |

最低 Apple 版本来自现有代码使用的 `toSorted`、`structuredClone`、Web Crypto 等 WebKit 能力；Vite 的语法 target 不会自动 polyfill 这些运行时 API。

## 安装与桌面开发

    npm ci
    npm run tauri -- info
    npm run tauri:dev
    npm run tauri:build

只检查编译、不打包安装器：

    cargo check --manifest-path src-tauri/Cargo.toml
    npm run tauri:build -- --no-bundle

macOS 发布还需 Apple Developer 证书、Developer ID/Application 或 App Store 配置、签名 entitlements 和 notarization。Windows 发布需代码签名证书，并分别在目标机验证 WebView2、MSI/NSIS 安装、升级和卸载数据保留。

## Android

先安装 Android Studio、SDK Platform/Build Tools、NDK、JDK，并用 rustup 添加 CLI 提示的 Android targets。首次生成工程：

    npm run tauri:android:init
    npm run tauri:android:dev
    npm run tauri:android:build -- --apk
    npm run tauri:android:build -- --aab

`src-tauri/gen/android` 应在初始化后提交；只有自动生成的 `gen/schemas` 被忽略。发布 AAB 前还需固定 `org.mousekeeper.client` application id、创建上传/发布 keystore、配置 Gradle signing、Play App Signing、版本号和隐私声明。debug 与 release application id 不同，不能用 debug 数据验证 release 升级。

## iOS / iPadOS

只可在 macOS 完整 Xcode 环境执行：

    npm run tauri:ios:init
    npm run tauri:ios:dev
    npm run tauri:ios:build

本机 Xcode beta 位于 `/Applications/Xcode-beta.app`，无需改变全局 `xcode-select` 即可按命令临时使用：

    DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer npm run tauri:ios:init
    DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer npm run tauri:ios:dev

Tauri 的嵌套 Xcode build phase 在当前版本不会完整继承临时 `DEVELOPER_DIR`。持续开发前建议由用户在终端执行一次全局切换（可随时切回）：

    sudo xcode-select --switch /Applications/Xcode-beta.app/Contents/Developer

`src-tauri/gen/apple` 应在初始化后提交。真机/App Store 发布还需 Apple Developer Team、唯一且固定的 bundle identifier、provisioning profile、Distribution 证书、签名、App Store Connect 记录和隐私清单。必须在锁屏/后台恢复、文件 Document Picker、网络中断和升级保留数据场景做真机验收。

## 跨平台文件与数据路径

- Web/PWA 导出继续使用 Blob + 浏览器下载；导入继续使用 `<input type=file>`。
- Tauri 导出使用系统保存对话框和 `plugin-fs` 写入用户明确选择的位置。取消保存会被视为“未落盘”，不会伪报成功。
- Tauri JSON/CSV/Provider 配置导入使用系统文档选择器，读取后仍转成标准 `File`，继续经过现有大小限制、预览、校验、一次性授权和事务流程。
- 业务数据仍在 WebView 的 IndexedDB/Dexie 中。它不是凭据存储，也不自动同步。卸载、清除 App 数据或设备损坏仍会丢失数据，必须定期导出 JSON 到 App 沙箱之外。
- Service Worker 只在生产 Web/PWA 中注册；Tauri 启动不依赖或注册 Service Worker。

Android content URI、iOS security-scoped document URL 和各平台保存对话框已按 Tauri 插件接口实现，但仍需要相应真机/模拟器回归。

## 凭据与网络安全

安全默认仍是 `authMode: none` 的用户网关：上游 API Key 保存在用户控制的本地或远程网关，MouseKeeper 客户端无需持钥。

原生持久凭据使用官方 Tauri Stronghold。保险库文件位于 App Local Data，内容由用户口令经 Argon2id 派生的 32 字节密钥加密：

- 每次 App 进程启动后必须由用户输入口令解锁；项目不存口令或自动解锁材料。KDF 使用应用固定 salt，因此必须选择长且唯一的高强度口令，避免与其他服务复用。
- 原生模式只允许“仅进程内存”或“平台加密保险库”，明确拒绝 sessionStorage/localStorage。
- 不可用、未解锁、口令错误或插件失败都会显式报错，不会退回明文文件、Web Storage、业务数据库或 Provider 配置。
- 备份、CSV 和 Provider 配置导出不含密钥；Provider 配置导出也清除 `secretRef`。
- Stronghold 保护静态存储，但解锁后的密钥仍需进入 WebView 内存以组装 Provider 请求头，不能抵御已执行的恶意同源脚本、恶意依赖或已攻陷设备。高风险部署应坚持持钥网关；未来如需进一步缩小运行时边界，应把 Provider transport 与密钥读取一起下沉到 Rust。

原生 Provider 请求使用 Tauri HTTP，避免 WebView CORS。权限仅允许任意 HTTPS 和 loopback HTTP（`127.0.0.1`/`localhost`）；不允许普通远程 HTTP。任意 HTTPS 是支持用户自定义 Provider 的明确取舍，因此只应配置可信端点。Web/PWA 继续使用浏览器 fetch、CORS 和混合内容规则。

## 当前环境验证记录（2026-08-02）

已完成：

- `npm run typecheck`
- `npm run lint`
- `npm test`：24 个文件、201 个测试通过
- `npm run build`
- `npm run test:e2e`：18 个场景通过、8 个按项目条件跳过（需允许 Chromium 在沙箱外启动）
- `CARGO_HOME=/private/tmp/mousekeeper-cargo cargo check --manifest-path src-tauri/Cargo.toml`
- 隔离 target、单线程的 `cargo build --release --manifest-path src-tauri/Cargo.toml`
- `npm run tauri -- info`：Tauri/插件配置解析通过
- `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild -version`：Xcode 27.0（27A5209h）
- `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcrun --sdk iphoneos --show-sdk-version`：iPhoneOS SDK 27.0
- rustup stable 1.97.1；`aarch64-apple-ios`、`aarch64-apple-ios-sim`、`x86_64-apple-ios` targets 已安装
- CocoaPods 1.17.0、libimobiledevice 1.4.0 已安装
- `tauri ios init --ci`：成功生成 `src-tauri/gen/apple/mousekeeper.xcodeproj`

当前机器安装了完整的 Xcode beta，但全局 `xcode-select` 仍指向 Command Line Tools；当前会话不能代输管理员密码完成全局切换。rustup、iOS targets、CocoaPods 与 libimobiledevice 已安装，`tauri ios init --ci` 已成功生成并运行 CocoaPods/XcodeGen。使用临时 Xcode wrapper 的无签名 arm64 模拟器构建已进入 Tauri Rust/Swift 编译，但 Xcode 27 beta 的 SwiftDriver 同时注入 iPhoneSimulator 与 macOS SDK，导致 UIKit/WebKit/AppKit 模块解析失败；这是 Xcode beta 与当前 Tauri 2.11.5 / swift-rs 1.0.7 的工具链兼容阻塞，不是签名失败。需在全局切换后复验；若仍存在，应改用受支持的稳定 Xcode 或等待/升级兼容版本。代码签名证书和 Development Team 仍未配置，因此真机与 IPA 发布未验证。Android 仍缺少完整 JDK/SDK/NDK 与 Rust Android targets 验证。Windows 也必须在 Windows CI/主机上构建和安装验证。Rust release binary 单线程编译通过；桌面 `tauri build --no-bundle` 在本机 root-owned Cargo cache 下仍有 proc-macro artifact 异常。Vite 主 chunk 大于 500 kB 是性能警告，不阻塞 Web 构建。
