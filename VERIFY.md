# 验证记录（v0.1 → v0.3）

## 1. 宿主半侧

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 插件被组合进 boot graph | ✅ | `GET /plugins/??dsh-timekeeper/client.js&rev=<rev>` 返回 200（裸 `/plugins/<id>/client.js` 一律 404，属正常设计） |
| 计时累加 | ✅ | `/dsh-timekeeper/stats` 的 `total` 多次采样单调递增（398 → 2498 → 3342 → 15423 → …） |
| 数据落盘 | ✅ | `%DSH_HOME%\dsh-timekeeper\usage.json` 存在且内容随采样增长 |
| 分享落盘路由 | ✅ | `node probe-share-save.mjs`：`POST /share` → 200，返回 `{ok:true, path, bytes}`，PNG 文件写入 `share/` |
| `/usage` 命令 | ✅ | 离线模拟输出：今日 / 本周 / 本月 / 累计 / 连续使用（v0.3 起追加目标与成就数） |
| v0.3 统计计算 | ✅ | `node probe-stats-v3.mjs`：环比（today pct=300、week pct=2、month pct=38）、时段分布、画像=白天型 79%、12 个徽章、目标 100%、专注 1 次/3 次 全部符合预期 |
| v0.3 路由（离线） | ✅ | `node probe-host-v3.mjs`：假 ctx 直接跑 `apply()`，**31 项全通过**（OPTIONS/CORS、/stats 字段齐全含 projects/session/reminders、/goal 合法性、/focus、/export、/import、/reset 确认、404、/usage 文本、session/event → 项目归属记录、usage.json 落盘 v2） |
| v0.3 客户端渲染（离线） | ✅ | `node probe-client-v3.mjs`：最小 React 桩 + 迷你渲染器，**40 项全通过**（标题/四卡+环比/目标/时段洞察/项目归属/提醒/徽章 5/12/热力图/年度小结/番茄钟/分享/数据管理/隐私说明） |
| v0.3 客户端交互（离线） | ✅ | `node probe-client-interact.mjs`：**68 项全通过**（分享按钮 POST /share 且 payload 为 PNG dataURL、4 主题 × 2 形状逐个生成并校验画布尺寸 1080×1520 / 1080×1080 与绘制文字无 NaN、卡片含成就区、目标保存 POST /goal、导出 GET /export、番茄钟进入运行态、清空两段确认 POST /reset） |
| v0.3 真·端到端（离线，真实数据） | ✅ | `node probe-live-host.mjs 6302` 用**真实 usage.json 的副本**起真实 HTTP 服务，再 `node verify-live.mjs 6302` **36 项全通过**：v0.3 字段齐全、goal 往返、focus +1、export→import 回灌后总时长不丢、落盘 version=2 且含 session/projects、`POST /share` 真落盘且 shareCount+1、`/reset` 缺 confirm 400 / 带 confirm 200 / 清空后归零 / 回灌快照能恢复、`/usage` 文案正常 |
| v0.3 线上实测（用户重启 DSH 后） | ✅ | `node verify-live.mjs 64627` **33 项全通过**：线上 v0.3 十六个字段齐全、目标往返与还原、专注 +1、导出回灌不丢、`usage.json` 落盘 v2 含 session/projects、`POST /share` 返回真实 PNG 路径、客户端诊断显示「正文注册成功」与「panel 已挂载 / 取数成功」、项目归属已记录到真实工作区 `DSHTask`（5 分 9%） |

## 2. 浏览器半侧

浏览器侧每个阶段向 `/client-diag` 打点。一次干净加载的序列：

```
apply: 进入
registerTab: 类型注册成功
registerTab: 正文注册成功
apply: sidebarRight 就绪
panel: 已挂载
panel: 取数成功 total=15423
```

- 面板渲染经用户截图确认：标题、四张卡片、连续使用横幅、日历热力图、年度小结齐全，v0.2 起分享卡片成图（1080×1520，排版无重叠）
- 面板每 30 秒自动刷新，取数值与 `/stats` 同步递增

## 3. 安装形态

- `plugin_manager install_bundle` 安装：profile 记录为 `link:D:/DSH/DSHTask/dsh-timekeeper`
- `dsh.profile.bundles` 含 `dsh-timekeeper`
- 修改 `lib/client.js` 后浏览器半侧会热重载（每次编辑产生新 rev 并重新执行 `apply`）；修改宿主 `lib/index.js` 必须重启 DSH

## 4. 已知踩坑（后续改动勿踩）

1. **Cordis inject**：未在 `inject` 声明就 `ctx.<service>` 取值会抛 `cannot get property "x" without inject`；必须用 `ctx.inject([...], scope => scope.x)` 或 `ctx.get?.("x")`。
2. **slot 注册写法**：用 `ctx.slots.inject(name, () => ctx.slots.register(...))`，不要用 generator `function*(){ yield ... }`。
3. **热重载残留**：同 id 重复注册会 throw `tab type id ... is already registered`；必须捕获后继续注册正文，否则标签页空白。
4. **热力图方向**：默认停在最左（最旧、全空），挂载后需 `scrollLeft = scrollWidth`。
5. **patch 文件**：`id` 行不要带行尾注释（插件管理器预检按行正则匹配）。
6. **面板滚动**：右侧栏 tab 正文容器是 `overflow:hidden`，面板自身必须 `height:100%; overflow-y:auto` 才能滚动。
7. **宿主/客户端职责**：宿主加了新路由后，旧宿主进程不会热更新；客户端要能用缺省值兜底（`normalizeStats`），避免宿主未重启时面板崩溃。
8. **对象字面量重复键**：`CARD_THEMES` 里先写 `label: "深蓝"`（显示名）又写 `label: "rgba(...)"`（画布颜色），后者覆盖前者，导致主题下拉显示成颜色值。已改显示名为 `name`，颜色仍用 `label`——对象里同名键静默覆盖，`node --check` 查不出来，靠离线渲染断言才暴露。
9. **宿主事件监听**：`ctx.on` 不是所有环境都有（离线 harness 里没有），必须写 `ctx.on?.("session/event", ...)`；会话工作区在 `session.header.cwd`，用最后一段目录名作项目名。

## 5. v0.3 增量检查表

- [x] 数据模型升级到 v2（days / hours / focus / goal / shareCount），旧 v1 数据加载时自动迁移
- [x] 按小时分桶：心跳把增量同时记入 `days` 与 `hours[今天][当前小时]`
- [x] 环比：今日 vs 昨日、本周 vs 上周、本月 vs 上月（`compare.pct`，无上期数据时为 null）
- [x] 时段洞察：24 小时分布、周内分布、高峰时段、画像（夜猫子/早起鸟/白天型/夜间型）
- [x] 成就徽章：12 个，含进度（time/days/count 三种单位）
- [x] 每日目标：`POST /goal` 保存，面板进度条 + 达成态
- [x] 番茄钟：25/45/60 分钟，完成 `POST /focus` 计入当日专注
- [x] 分享卡片：4 主题 × 2 形状（竖版 1080×1520 / 方形 1080×1080），含已解锁成就
- [x] 数据管理：`GET /export`、`POST /import`（结构校验）、`POST /reset`（confirm 二次确认）
- [x] 隐私说明：数据仅存本机
- [x] 项目归属：`ctx.on?.("session/event")` 读取 `session.header.cwd` → 项目名（目录最后一段），心跳把增量同时记入 `projects[今天][项目]`；面板显示今日排名（前 6 + 其他）与累计占比
- [x] 智能提醒：宿主按心跳断档（>5 分钟算新一段）维护 `session.startAt`，连续 120 分钟推「起来活动」，20 点后目标未达成推「还差多少」，目标达成推庆祝；文案由 `computeStats` 统一产出 `reminders[]`，`/usage` 与面板共用
- [ ] 待用户浏览器确认：新面板各区块渲染正常、目标保存生效、番茄钟倒计时与完成上报、四套主题卡片成图、项目归属出现真实工作区名

## 6. 待人工确认

- [ ] 面板可滚动到最底部「数据管理」区
- [ ] 「今日目标」填 2 小时 → 保存 → 进度条出现
- [ ] 选 1 分钟（临时改）或 25 分钟专注 → 完成后「今日专注」+1
- [ ] 分享卡片切换 4 个主题 + 方形，各生成一张，确认配色与排版
- [ ] 连续用满 2 小时后看到「起来活动 5 分钟」的红色提醒（或 `/usage` 末尾出现连续时长与提醒）
