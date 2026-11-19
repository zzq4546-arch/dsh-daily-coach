# dsh-calendar-coach

日历 · 每日 DDL · 准时提醒 · 每日教练，合成一个 DSH 插件（宿主 + 浏览器两张脸）。

数据只有一份：`<DSH_HOME>/calendar/calendar.json`（本机默认 `D:\DSH\home\calendar\calendar.json`）。
原来的 `dsh-daily-coach` 的 localStorage 键（`dsh-daily-coach.v2` / `.plan.v1`）原样保留，
打卡、复盘、笔记、计划一行代码都没改，所以旧数据零迁移。

## 它能做什么

- **特殊日子**：纪念日 / 生日 / 节日 / 自定义，支持公历和农历（农历按内置 1901–2100 节气表换算），支持每年重复或只过一次。
- **百天里程碑**：以纪念日为锚点，自动标出第 100/200/300…天，以及 365（一周年）/520（我爱你）/999/1314（一生一世）/2000/3000 天等节点。
- **每日 DDL**：某天某个时间要做什么，可勾完成、可标优先级，逾期会单独列出来。
  **新加/改过的 DDL 至少在你设置 1 小时后才提醒**（晚上补记当天任务不会立刻弹卡打扰）。
- **三路提醒**：
  - A 应用内醒目浮层（页面开着时，顶部弹卡 + 提示音 + 系统通知）
  - B 重要节点发聊天消息（宿主 `schedule` 服务投递给当前会话，页面没开也能到）
  - C 每天早报（默认 08:00，一条消息汇总今天）
  - 打开时补发 36 小时内漏掉的提醒
- **两种形态随时切换**：右下角浮卡 ↔ center 列整页（教练面板右上角「⤢」按钮）。
- **AI 直接落地**：对 DSH 说"记一下 3 月 14 日是恋爱纪念日""这周五前交简历"，模型会调工具写进同一份数据，不用手动点。

## 对模型暴露的工具

| 工具 | 用途 |
| --- | --- |
| `calendar_today` | 今天有什么（节日、纪念日、里程碑、到期/逾期 DDL） |
| `calendar_list` | 查区间内的事件与 DDL |
| `calendar_add_event` | 加纪念日/生日/节日（可公历或农历、可设提前几天提醒） |
| `calendar_add_ddl` | 加一条 DDL（日期、可选时间、优先级） |
| `calendar_update` / `calendar_delete` | 改期、改提醒、勾完成、删除 |
| `calendar_remind` | 把聊天提醒绑到当前会话 / 开关早报 |

## HTTP 接口（浏览器端用）

前缀 `/api/dsh-calendar`，必须带 `x-dsh-calendar: 1` 头，跨源请求一律 403。

- `GET /health`、`/state?from&to`、`/today?date`、`/lunar?date`、`/pending`、`/upcoming?days`
- `POST /op`（`{op, payload}`）、`POST /mode`（`{mode:'card'|'page'}`）

## 开发

浏览器端由三个片段拼成，改完必须重新构建：

```
src/coach.js     合并后的每日教练（var COACH）
src/calendar.js  日历页 + 提醒卡（var CAL）
src/shell.js     座位注册 / 形态切换 / 轮询（function apply）

node build.mjs   # → client.js
```

片段规则：ES5 语法（`var` + `function`）、无 `import/export`、顶层只有一个绑定、
不直接操作 `document.body`、颜色只用 `--dsw-alias-*` token。构建器会校验，不符合就拒绝产出。

农历表 `lib/lunar-table.js` 由 `tools/gen-lunar-table.ps1` 用 .NET
`ChineseLunisolarCalendar` 生成（1901–2100）。**不要**改用 `Intl` 的
`zh-CN-u-ca-chinese`：CLDR 与官方农历有偏差（如 2027 年春节会差一天）。

### 工具 schema 的硬要求

输出 schema（`output.schema`）：宿主的 `register()` 会校验它，**每一个 object 都必须显式写
`additionalProperties`**，漏一层就抛
`JsonSchemaError: unsupported JSON schema: … must be explicitly true or false`，
而且会**让整个插件 activate 失败**（不是只坏一个工具）。`lib/tools.js` 的
`strictSchema()` 会递归补全，新增工具一律用 `outSchema()` 生成输出 schema。

参数 schema（`parameters`）：`register()` **完全不校验**，会原样塞进
`tools[].function.parameters` 发给模型 API。所以这里要么写成完整 JSON Schema，
要么交给官方 `defineTool()` 编译；直接写「每个属性挂 `required: true`」的简写而不编译，
每轮对话都会被 API 打回、整轮失败（2026-11-17 就是这么挂的）：

```
Invalid schema for function 'calendar_add_ddl':
{"type":"string","required":true,"description":"要做什么"} is not of type "string"   (INVALID_REQUEST)
```

`defineTool` 从 `@deepseek-ai/dsh-tools` 取，桌面宿主里这一步会失败
（`Cannot find package '@deepseek-ai/dsh-tools'`，见 `register.log` 的
`defineTool=missing -> 自己编译 parameters`），因此 `lib/tools.js` 自带
`paramSchema()`：把简写编译成 `{ type:'object', properties, required:[…] }`，
与官方编译结果一致。新增工具只写简写即可，两条路径都覆盖。

自检：`node _scratch/schema-check.mjs`（截获 7 个工具的注册定义，逐项体检 schema，
并打印 `calendar_add_ddl` 真实发给 API 的那一份）。修复前的两份文件放在
`_scratch/rollback/`，要回滚直接覆盖 `lib/` 下同名文件。

### 在真实宿主里跑一遍（不动桌面 profile）

```
$env:DSH_HOME="<临时目录>"
dsh plugin --profile caltest add "file:<本包绝对路径>"
dsh --profile caltest web
```

看两件事：日志里没有 `warning: N entry did not activate`，且
`<临时目录>/calendar/calendar.json` 被创建。

## 安装

桌面版 profile 由 Electron 独占管理，不能 `dsh plugin add`。手动安装：

1. 把本目录整份复制到 `<DSH_HOME>/profiles/desktop/node_modules/dsh-calendar-coach`
2. 在 profile 的 `package.json` 里：
   - `dependencies` 加 `"dsh-calendar-coach": "file:<本目录绝对路径>"`
   - `dsh.profile.bundles` 数组加 `"dsh-calendar-coach"`
   - 想停用旧版就同时从 bundles 里去掉 `"dsh-daily-coach"`（数据不会丢）
3. 重启桌面应用。

## 装好之后怎么验（逐条打勾）

1. 侧栏出现「日历」图标；点开是整页月历（今天那格高亮，格子里有农历小字）。
2. 在对话里说「记一下 12 月 24 日是恋爱纪念日」，我会回一条带「下一次」的确认，然后侧栏/浮卡里就能看到。
3. 说「和 TA 在一起是 2026-05-01，100 天和 200 天记得提醒我」→ 回复里会给出第 100/200 天的具体日期。
4. 说「今天有什么」→ 会给出公历 + 农历 + 当天 DDL + 逾期项。
5. 浮卡右上角「⤢」可随时在浮卡/整页之间切换；切完关掉应用再开，形态会被记住。
6. 到点提醒：应用内是红金渐变的醒目卡片 + 提示音；重要节点（纪念日提前 1 天/当天、DDL 到期）还会作为一条聊天消息由我主动发给你。

> `_scratch/` 是自检用的临时目录（无头浏览器 harness 与 vendor 里的 React），可以整份删除，不影响插件。
> 会话绑定是自动的：第一次在某个会话里用日历工具，聊天提醒就绑到那个会话，不用手动绑。

## 已知边界

- DSH 完全退出时没有任何进程能提醒你；下次打开会补发。
- `schedule` 记录绑在当前会话上；换会话后用 `calendar_remind` 重新绑一次。
- 2 月 29 日的纪念日在平年退到 2 月 28 日；农历腊月三十在只有廿九的年份退到廿九。
- 每周年只报一次（周年那天），不会再额外报一次「第 365 天」。

## 调试与排障（2026-11-17 实战补充）

宿主端在 Electron 里看不到 stdout，所有关键事件都写进
`D:\DSH\home\calendar\register.log`（apply 开始、ctx 服务形态、每个工具注册成败、提醒排定/清理）。
出问题先看它。

### 工具注册的三条硬要求（都是宿主 `ctx.tools.register()` 现教的）

1. `output` 必须同时有 `schema` 和 `render`：`must declare output { schema, render, presentationMeta? }`。
   `render(args, value)` 返回 `[{ type: 'text', text }]`——少了它整个工具注册失败。
2. 值 schema 不能出现 `type: 'json'`（合法值只有 object/array/string/number/integer/boolean/null），
   属性节点里也不能写 `required`（会报 `required is not supported on type "boolean"`）。
   本包统一走 `lib/tools.js` 的 `out()`：`{ type:'object', additionalProperties:true, properties:{ ok, text, ... } }`。
3. 每个 object 节点必须显式 `additionalProperties`，否则整个插件 activate 失败（不是只坏一个工具）。

### 聊天提醒绑定的规则

- 只在**用户会话**里绑：`session.header.delegationDepth` 或 `options.subagentDepth` > 0 的子 agent 会话直接跳过
  （子 agent 跑完就散，提醒会投进没人看的会话）。
- 绑定后早报（daily）与重要节点（一次性 at）都投进这个会话；改绑/解绑会先删旧记录再建新的。
- 每条聊天提醒的 prompt 末尾带 `[[cal:<key>]]` 标记，同步时按标记比对清单，
  用户删掉纪念日/改了日期，对应的定时记录会被自动清理。

### 热更新（不用重启桌面应用）

`plugin_manager` 对本插件条目 `include:dsh-calendar-coach` 先 `enabled=false` 再 `enabled=true`，
宿主会重新 import 一遍并把插件挂回去——改完 `lib/*.js` 用这招即可生效；`client.js` 需要 `node build.mjs`
并刷新页面。

### 数据里可以安全手动看的东西

`D:\DSH\home\calendar\calendar.json`：`events` / `ddls` / `meta.notifySessionId` / `meta.digestRecord` / `scheduled`。
`fired` 里是"已经弹过的提醒"的去重键，残留无害。
**注意**：宿主把状态缓存在内存里，直接手改这个文件会被下一次写入覆盖；
要改绑定关系请走 `POST /api/dsh-calendar/op {op:'bindSession',payload:{sessionId}}`。

---

## 两种形态（浮卡 / 整页）到底差在哪

| | 浮卡（card） | 整页（page） |
|---|---|---|
| 位置 | 右下角浮动卡，盖在对话上 | 占住中间主区，对话退到旁边 |
| 适合 | 边聊边记 DDL、随手勾完成 | 集中看月视图、批量改纪念日 |
| 切换 | 卡片头部「⤢ 整页」 | 卡片头部「⤢ 浮卡」，或再点一次侧栏「日历」收起 |

**「⤢ 整页」按钮做两件事**：①把形态切成 page；②调 `ctx.get("layout").selectPanel("dsh-calendar-coach")`
让 Shell 真正选中我们的面板。第二件是必须的——只切形态而不选中面板时，用户看不到任何变化（早期版本就是只做了 ①，
所以按了没反应）。点「⤢ 浮卡」则相反：切回 card + `selectPanel(null)` 把主区还给对话。

侧栏「日历」那一行等价于「打开整页」：Shell 选中面板 → PageView 挂载 → 形态自动切到 page。

**改了 client.js 之后**：`node build.mjs` 可让宿主端立刻可用（junction 安装），但浏览器端要**刷新页面**才生效；
只想重载宿主侧的 `lib/*.js`，用 `plugin_manager set_plugin enabled=false/true` 切两次即可（不用重启应用）。
