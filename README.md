# dsh-timekeeper

DeepSeek Harness 时间账本：从进入 DSH 起自动记录时间投入，并把它变成看得懂的习惯洞察。

## 功能（v0.3）

- **自动计时**：宿主插件常驻，进入 DSH 即开始累计，无需手动操作；按天 + 按小时双粒度记录
- **四维统计面板**：今日 / 本周 / 本月 / 累计，每格带**环比**
- **每日目标**：设置每天想投入多少小时，面板显示进度条与还差多少，达成后庆祝
- **智能提醒**：连续使用满 2 小时提示起来活动；到了 20 点目标还没达成、或刚好达成时给出对应提示
- **项目归属**：宿主监听会话事件，把时长拆到当前工作区；面板显示今日各项目占比与累计占比
- **时段洞察**：24 小时分布 + 周内分布 + 高峰时段 + 时段画像
- **成就徽章**：12 个徽章，未达成的显示进度
- **专注番茄钟**：25/45/60 分钟专注计时，完成后计入今日专注
- **日历热力图**：过去一年每日时间账本
- **连续使用天数**：streak 统计
- **年度小结**：本年累计、平均每天、最长连续、最勤奋的一天、记录起点
- **分享卡片**：1080×1520 竖版 / 1080×1080 方形，4 套配色主题，优先由宿主落盘成 PNG
- **数据管理**：导出 JSON 备份、粘贴导入、二次确认清空；**全部数据只存本机，不上传**
- **`/usage` 命令**：输入框敲 `/usage` 查看今日/目标/本周/本月/累计/连续天数/成就数/画像

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半侧 Cordis 插件：计时心跳、数据落盘、统计/目标/专注/导入导出/分享路由、`/usage` 命令 |
| `lib/client.js` | 浏览器半侧：把「时间账本」标签页注册进右侧栏，渲染面板、番茄钟、分享卡片 canvas 绘制 |
| `cordis.patch.yml` | bundle patch，把插件插入配置树 |
| `package.json` | `dsh.bundle.patch` + `dsh.client`（platform: web）声明 |

## 数据存储

使用数据落盘到 DSH 主目录（`$DSH_HOME`，默认 `~/.dsh`）下的：

- `dsh-timekeeper/usage.json` —— `days`、`hours`、`projects`、`focus`、`goal`、`session`、`shareCount`
- `dsh-timekeeper/client-diag.jsonl` —— 客户端诊断日志
- `dsh-timekeeper/share/usage-card-<时间戳>.png` —— 分享卡片导出的图片

> 兼容性：v0.1 的旧 `usage.json` 只有 `days`，加载时会自动升到 v2 结构，历史天数据保留。
> 小时分布从 v0.3 起才开始记录，因此早期日期没有时段数据。
> 更名说明：插件早期名为 `dsh-usage-time`，数据目录随之从 `~/.dsh/dsh-usage-time/` 迁到 `~/.dsh/dsh-timekeeper/`；改名时用 `GET /export` + `POST /import` 合并了两边记录，旧目录保留未删，可自行清理。
> 计时口径：每 30 秒心跳一次，**单拍最多计入 120 秒**——系统休眠/挂起醒来后的长间隔会被截断（合盖睡一晚不会记成用了 8 小时），截断事件会写进 `client-diag.jsonl`。应用挂在后台但没退出时仍会继续计时。

## 宿主 HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-timekeeper/stats` | 四维 + 环比 + 365 天明细 + 时段分布 + 画像 + 目标 + 专注 + 徽章 + 项目归属 + 连续会话 + 提醒 |
| GET | `/dsh-timekeeper/client-diag` | 最近 80 条客户端诊断事件 |
| GET | `/dsh-timekeeper/client-diag?e=<文本>` | 追加一条诊断 |
| POST | `/dsh-timekeeper/share` | 请求体 `{"dataUrl":"data:image/png;base64,..."}`，落盘为 PNG 并返回路径 |
| POST | `/dsh-timekeeper/goal` | 请求体 `{"dailySeconds":7200}`（0 ~ 57600） |
| POST | `/dsh-timekeeper/focus` | 请求体 `{"seconds":1500,"sessions":1}`，累加当日专注 |
| GET | `/dsh-timekeeper/export` | 返回完整原始状态 `{ok, exportedAt, state}` |
| POST | `/dsh-timekeeper/import` | 请求体 `{state:{days,...}}`，整体替换（做结构校验） |
| POST | `/dsh-timekeeper/reset` | 请求体 `{"confirm":true}`，清空全部统计 |

## 安装

用官方插件管理器安装（不要手改 profile 的 package.json）：

```
plugin_manager action=install_bundle target=D:\DSH\DSHTask\dsh-timekeeper
```

安装后该目录会以链接包形式出现在 profile 的 `node_modules/dsh-timekeeper`，
并登记进 `dsh.profile.bundles`。替换代码后需要重启 DSH 才会重新组合 client bundle。

## 使用

- 打开右侧栏，点时间账本入口，面板可上下滚动
- 目标：在「今日目标」行填小时数 → 保存目标
- 专注：选 25/45/60 分钟 → 开始专注；完成自动记入「今日专注」
- 分享：选主题与形状 → 生成分享卡片，图片会保存到 `~/.dsh/dsh-timekeeper/share/` 并显示路径
- 备份：数据管理 → 导出 JSON；导入时把 JSON 粘进文本框再点导入备份
- 输入框输入 `/usage` 查看文字小结

## 调试

- `GET /dsh-timekeeper/client-diag` 返回最近 80 条客户端诊断事件
- 浏览器侧加载/注册中每一步都会打点：`module:` → `apply:` → `registerTab:` → `autoOpen:` → `panel:` → `share:` → `focus:`
- 离线单测：
  - `node probe-host-v3.mjs` —— 用假 ctx 跑宿主 `apply()`，覆盖全部 HTTP 路由与 `/usage` 命令
  - `node probe-client-v3.mjs` —— 最小 React 桩渲染面板，校验各区块都渲染出来
  - `node probe-client-interact.mjs` —— 点击分享/保存目标/导出/番茄钟/清空，并逐个校验 4 主题 × 2 形状的画布尺寸与文字
  - `node probe-stats-v3.mjs` —— 合成数据的统计口径自测
  - `node probe-live-host.mjs 6302` + `node verify-live.mjs 6302` —— 用真实 `usage.json` 的副本起真实 HTTP 服务，跑全部端点；重启 DSH 后可直接对线上端口执行 `verify-live.mjs`

> 注意：**宿主半侧改代码需要重启 DSH 才会生效**；浏览器半侧 `lib/client.js` 改动会自动热重载。

## 路线图

- v0.1 ✅：自动计时 + 四维面板 + 热力图 + 连续天数
- v0.2 ✅：可分享的年度总结卡片
- v0.3 ✅：环比、时段洞察、成就徽章、每日目标、番茄钟、分享主题/方形、数据导入导出、项目/工作区归属统计
- v0.4：跨设备同步、周报页面、更多徽章与主题
