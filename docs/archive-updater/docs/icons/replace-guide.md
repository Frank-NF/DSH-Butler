# DSH-PluginUpdater 图标替换执行指南

> **版本**: v2.0 玻璃拟态图标集
> **替换日期**: 2026-09-07
> **替换范围**: 前端 UI 图标 + 桌面程序图标

---

## 一、替换内容总览

### 1.1 前端 UI 图标

| 项目 | 内容 |
|------|------|
| **管理文件** | `src-vue/src/components/WIcon.vue` |
| **图标数量** | 60+ 个（原有 40 个重新设计 + 新增 20+ 个） |
| **风格** | 玻璃拟态，2px 线宽，圆角端点，currentColor 描边 |
| **备份文件** | `src-vue/src/components/WIcon.vue.bak` |

### 1.2 桌面程序图标

| 项目 | 内容 |
|------|------|
| **源图标** | `icon-build/app-icon-source.png`（1024×1024 PNG） |
| **生成工具** | `npx @tauri-apps/cli icon` |
| **输出目录** | `src-tauri/icons/` |
| **包含格式** | ICO、ICNS、PNG（多尺寸）、Android、iOS、Appx |

---

## 二、前端图标替换详情

### 2.1 修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src-vue/src/components/WIcon.vue` | 重写 `ICONS` 对象，全部图标重新设计为玻璃拟态风格 |
| `src-vue/src/components/HeaderBar.vue` | 品牌 Logo 从 `package` 改为 `dsh-logo` |

### 2.2 新增的图标（20+ 个）

| 分类 | 新增图标名 |
|------|-----------|
| 品牌 | `dsh-logo` |
| 操作 | `install`, `update`, `uninstall`, `disable`, `rollback` |
| 状态徽章 | `status-latest`, `status-update`, `status-failed`, `status-disabled` |
| MCP | `mcp-connect`, `mcp-radar`, `mcp-token` |
| 组合包/快照 | `combo-package`, `snapshot`, `snapshot-import`, `offline-package`, `zip`, `registry` |

### 2.3 保持不变的图标名

以下图标名保持不变，确保现有组件引用不受影响：

`plugin`, `grid`, `core`, `layers`, `package`, `server`, `folder`, `refresh`, `upload`, `download`, `trash`, `power`, `search`, `searchOff`, `sort`, `list`, `copy`, `zap`, `wand`, `check`, `close`, `info`, `alert`, `clock`, `inbox`, `wifiOff`, `shield`, `fileText`, `star`, `more`, `settings`, `globe`, `wrench`, `sun`, `moon`, `link`, `external`, `arrowRight`, `chevronRight`, `chevronDown`

---

## 三、桌面程序图标替换详情

### 3.1 生成的图标文件清单

```
src-tauri/icons/
├── icon.ico                          # Windows 图标（多尺寸）
├── icon.png                          # 通用 PNG
├── icon-256.png                      # 256×256
├── 32x32.png                         # 32×32
├── 64x64.png                         # 64×64
├── 128x128.png                       # 128×128
├── 128x128@2x.png                    # 256×256（Retina）
├── icon.icns                         # macOS 图标
├── StoreLogo.png                     # Windows 商店
├── Square30x30Logo.png               # Windows 磁贴
├── Square44x44Logo.png
├── Square71x71Logo.png
├── Square89x89Logo.png
├── Square107x107Logo.png
├── Square142x142Logo.png
├── Square150x150Logo.png
├── Square284x284Logo.png
├── Square310x310Logo.png
├── android/
│   └── mipmap-*/                     # Android 各密度图标
└── ios/
    └── AppIcon-*.png                 # iOS 各尺寸图标
```

### 3.2 重新生成图标命令

如需重新生成（更换源图标后）：

```bash
# 1. 准备 1024×1024 PNG 源图标
# 2. 在项目根目录运行
npx @tauri-apps/cli icon "icon-build/app-icon-source.png"
```

---

## 四、验证清单

### 4.1 前端验证

- [x] TypeScript 类型检查通过（`npx vue-tsc --noEmit`）
- [x] 前端构建成功（`npx vite build`）
- [x] 所有现有图标名保持不变，无引用断裂
- [x] HeaderBar 品牌 Logo 更新为 `dsh-logo`
- [x] 深色/浅色主题下图标颜色跟随 currentColor

### 4.2 程序图标验证

- [x] Tauri 图标生成成功
- [x] icon.ico 生成（Windows）
- [x] icon.icns 生成（macOS）
- [x] Android/iOS 图标生成
- [x] Windows Appx 商店图标生成

### 4.3 手动验证步骤

1. 启动开发服务器：`npm run tauri dev`
2. 检查顶部工具栏 Logo 是否为新的插头+循环箭头图标
3. 检查所有按钮图标是否为玻璃拟态风格
4. 检查插件状态徽章（最新/可更新/失败/禁用）是否正常显示
5. 检查 Windows 任务栏程序图标是否更新
6. 切换深色/浅色主题，确认图标颜色自适应

---

## 五、回滚方案

如需回滚到旧版图标：

### 5.1 前端图标回滚

```bash
# 恢复 WIcon.vue 备份
copy src-vue/src/components/WIcon.vue.bak src-vue/src/components/WIcon.vue

# 恢复 HeaderBar.vue 的 Logo
# 将 <WIcon name="dsh-logo" :size="20" /> 改回 <WIcon name="package" :size="20" />
```

### 5.2 程序图标回滚

程序图标已被 Tauri 工具覆盖，如需回滚需从 Git 历史恢复：

```bash
git checkout HEAD -- src-tauri/icons/
```

---

## 六、后续维护建议

1. **新增图标**：在 `WIcon.vue` 的 `ICONS` 对象中添加，并在 `docs/icons/icon-naming.md` 中补充说明
2. **更换程序图标**：准备 1024×1024 PNG，运行 `npx @tauri-apps/cli icon <path>`
3. **图标风格统一**：所有图标保持 2px 线宽、圆角端点、currentColor 描边
4. **状态徽章颜色**：通过 CSS class 控制颜色（`text-success`、`text-warn`、`text-danger`、`text-muted`）

---

## 七、相关文档

- [图标命名与用途对照表](./icon-naming.md)
- [WIcon 组件源码](../../src-vue/src/components/WIcon.vue)
- [Tauri 图标官方文档](https://tauri.app/develop/icons/)
