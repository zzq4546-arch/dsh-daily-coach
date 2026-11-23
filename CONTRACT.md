# dsh-calendar-coach — 实施契约（v1，所有模块必须遵守）

这是「日历 + DDL + 提醒 + 教练」合并插件。**一个包装两张脸**：宿主端（Node）管数据、工具、定时提醒；
浏览器端（client.js）出 UI。M1 合并策略：dsh-daily-coach 的四个页签被搬进本包，加一个「日历」页签，
localStorage 键名一字不改（`dsh-daily-coach.v2` / `dsh-daily-coach.plan.v1`），旧数据零迁移。

## 0. 落盘位置

- 源码：`C:\Users\32354\Documents\deepseek-harness\default-workspace\dsh-calendar-coach\`
- 数据：`D:\DSH\home\calendar\calendar.json`（宿主创建；`$env:DSH_HOME` + `calendar/calendar.json`）
- 安装：复制整个包到 `D:\DSH\home\profiles\desktop\node_modules\dsh-calendar-coach`，并在
  `D:\DSH\home\profiles\desktop\package.json` 的 `dependencies` 与 `dsh.profile.bundles` 各加一行，重启桌面应用生效。

## 1. 构建

`build.mjs`（Node 24，无依赖）把 `src/` 三个片段按顺序拼成一个 `client.js`：

    window.__ModuleLoader__.load({ id: 'dsh-calendar-coach', factory(require) {
      'use strict';
      /* ---- src/coach.js ---- */
      var COACH = (function () { ... })();
      /* ---- src/calendar.js ---- */
      var CAL = (function () { ... })();
      /* ---- src/shell.js ---- */
      function apply(ctx) { ... }
      return { apply: apply };
    }});

片段规则（每个文件都必须满足）：

1. 纯脚本片段：**不准**出现 `import` / `export` / `window.__ModuleLoader__` / 顶层 `document.body.appendChild`。
2. 每个文件只声明**一个**顶层绑定：`coach.js → var COACH`，`calendar.js → var CAL`，`shell.js → function apply`。
3. 其余全部包在各自 IIFE 里，不准泄漏全局变量；`window` 上最多挂 `window.__DSH_CALENDAR_COACH__` 调试对象。
4. 代码风格：ES5 语法（`var` + `function`），不用箭头函数 / 模板字符串 / 可选链——与 coach 原文件保持一致，
   因为要拼进它。允许 `async/await`（浏览器都支持）。
5. 样式：`calendar.js` / `shell.js` 自己的类名一律 `calc-` 前缀，颜色只用 `var(--dsw-alias-*, <fallback>)`；
   coach 原有的 `.ddc-*` 样式原样保留，不要改。
6. 所有面向用户的文案用中文（不引 locale 框架，直接中文字符串）。

## 2. 数据模型（宿主产出、前端消费；日期键一律 `YYYY-MM-DD`）

    Event = {
      id: "evt_...", title: "恋爱纪念日",
      type: "anniversary" | "birthday" | "festival" | "custom",
      calendar: "solar" | "lunar",              // 每年重复时按哪种历法算
      date: "03-14" | "2026-03-14",             // MM-DD = 每年重复；YYYY-MM-DD = 一次性
      lunarMonth: 2, lunarDay: 14, lunarLeap: false,   // calendar==="lunar" 时给出
      repeat: "yearly" | "once",
      leadDays: [7, 1, 0],                      // 提前几天提醒（0 = 当天）
      remindTime: "09:00",
      note: "", tag: "", color: "rose",
      createdAt: 1730000000000, updatedAt: 1730000000000,
    }

    Ddl = {
      id: "ddl_...", date: "2026-11-20", time: "18:00" | "",
      title: "交实习简历", done: false, doneAt: 0,
      priority: "high" | "normal" | "low", note: "", origin: "user" | "ai",
      createdAt, updatedAt,
    }

    Milestone = {                                 // 「在一起 100 天」这类日子，由锚点算出，不单独存
      id: "ms_...", eventId: "evt_anchor", title: "在一起 200 天",
      anchorDate: "2026-05-01", days: 200, date: "2026-11-17", done: false,
    }

    Occ = {  // 某一天的一条"发生"（事件/里程碑/节日），前端列表与提醒都用它
      dateKey: "2026-11-17", kind: "event" | "milestone" | "festival",
      refId: "evt_.."/"ms_..", title: "恋爱纪念日 · 第 200 天",
      lunarText: "丙午年十月初八", daysFromToday: 0, level: "important" | "normal",
    }

    Reminder = { // 宿主算好的待提醒项，前端轮询取走
      id: "rem_...", kind: "event" | "ddl" | "milestone" | "digest",
      title, body, at: 1763000000000, dateKey: "2026-11-17",
      level: "important" | "normal", fired: false, acked: false,
    }

    State = {
      rev: 12,                                    // 每次写 +1，前端用来判断要不要重渲染
      events: [Event], ddls: [Ddl], anchors: [Event],  // anchors 是带 anchorDate 的里程碑事件
      today: { dateKey, lunarText, festivals: [string], events: [Occ], ddl: [Ddl], overdue: [Ddl],
               milestoneToday: [Milestone] },
      pending: [Reminder],
    }

## 3. 宿主 HTTP API（同源，前缀 `/api/dsh-calendar`）

所有响应 `application/json; charset=utf-8`；错误 `{ ok:false, error:"..." }`，HTTP 4xx/5xx。
**准入**：请求必须带 `x-dsh-calendar: 1` 头；带了 `Origin` 且与自身 host 不一致 → 403。GET 只读，写只走 POST。

    GET  /state?from=YYYY-MM-DD&to=YYYY-MM-DD   -> { ok:true, state: State }   (from/to 可省=当月)
    GET  /today                                  -> { ok:true, today: State.today }
    GET  /lunar?date=YYYY-MM-DD                  -> { ok:true, lunar:{ text:"丙午年十月初八", month:10, day:8, leap:false, festivals:[...] } }
    GET  /pending                                -> { ok:true, pending:[Reminder] }
    POST /op   { op:"event.add"|"event.update"|"event.delete"|
                     "ddl.add"|"ddl.update"|"ddl.toggle"|"ddl.delete"|
                     "anchor.set"|"reminder.ack"|"reminder.snooze", payload:{...} }
                                              -> { ok:true, state: State }
    POST /mode  { mode:"card"|"page" }           -> { ok:true }        (记住形态偏好，宿主存 meta)

前端不拼 URL 细节：shell 提供 `api` 对象（见 §5），calendar.js 只用 `api.*`。

### 3.1 `/focus`（考试日期）

```
GET /api/dsh-calendar/focus
→ { ok:true, data:{ finals:[{title,date,time,end}], optional:[{title,date,time,end,kind}] } }
```

数据源 `lib/focus-dates.js`（学期硬编码，后续抽成配置）。导入走 `POST /op` 的
`{op:'importFocusDates', payload:{ keys:['date|title', ...] }}`：已存在同日期同标题的 DDL 跳过，
日期早于今天记为过期，返回 `{added, skipped, expired}`。

## 4. 提醒引擎（宿主）

- 每条 Event 的每个 `leadDays` × `remindTime`、每条未完成 DDL 的 `date+time`（提前 2 小时与到点各一次）、
  每天的早报（默认 08:00，可读 meta.digestTime）都进入一个**幂等**的待提醒队列，去重键
  `kind:refId:dateKey:lead`。
- 宿主每 60s 扫一次，到点的项标记 `fired=true` 写进 `calendar.json` 的 `reminders` 数组（保留最近 200 条），
  (A) 前端轮询 `/pending` 取走 → 醒目浮层；(B) 重要级别（纪念日提前 7/1 天、当天、DDL 到期）同时经宿主
  `schedule` 服务向绑定的会话投递一条消息；(C) 每天早报一条 digest。
- 应用重启时补发：`at` 在过去 36h 内且未 ack 的项一次性合并成一条"你不在时有 N 件事"。

## 5. 浏览器端模块契约

### 5.1 `COACH`（src/coach.js，由 coach-merge 负责）

    COACH = {
      mount(container: Element) -> Element|null,  // 把面板 DOM 建到 container 里并返回根节点；不自己定位置、不 append 到 body
      unmount(): void,
      root(): Element|null,
      switchTab(key: 'calendar'|'today'|'review'|'notes'|'plan'): void,
      paneEl(key): Element|null,
      renderAll(): void,
      setMode(mode: 'card'|'page'): void,   // card=今天那样可拖拽浮动；page=整页，禁用拖拽/固定定位
      calendarPane(): Element|null,          // 第 5 个页签的面板容器（CAL 往里画）
      opts: { onToggleMode?: function, onOpenDay?: function }  // mount 前由 shell 赋
    }

- `TAB_KEYS` 变成 `['calendar','today','review','notes','plan']`，页签按钮沿用现有 `data-ref` + `data-act` 机制，
  新按钮 `data-ref="tabCalendar"`、标签「日历」；新面板 `<section class="ddc-pane" data-pane="calendar" role="tabpanel"></section>`，
  位置在最前。默认 `state.tab` 仍是 `'today'`（老用户打开还是老样子）。
- coach 内部的 `apply(ctx)` 与 body 级挂载全部删掉，改成被 shell 调用 `mount(container)`；折叠胶囊（pill）
  也渲染进同一个 container，不再 append 到 `document.body`。`document.body` 允许出现的仅剩
  `legacyCopy` / `downloadText` 里那两个临时元素（保留原样）。
- 原有 localStorage 读写、审批码、计划、复盘、笔记逻辑**一行不改**。

### 5.0 `FOCUS`（src/focus.js）

`mount(host, {data, save, api})` 后由 `COACH` 的 `focus` 页签驱动；`summary()` 给浮卡顶部摘要，
`refresh()` 在切到该页时重拉数据，`tick()` 由 shell 的 30s 泵调用。`api.dates()` 读 `/focus`，
`api.import(selection)` 走 `importFocusDates` op。CSS 由 `FOCUS.css` 单独导出，构建时并入样式。

### 5.2 `CAL`（src/calendar.js，由 calendar-ui 负责）

    CAL = {
      mount(opts) // opts: { coach: COACH, api: Api, overlay: Element, onOpenCoachTab: fn }
      renderPane(container) // 画月视图 + 当日详情；container 就是 COACH.calendarPane()
      refresh()             // 从 api.state() 重取并重画
      openDay(dateKey)
      showReminder(rem)     // 醒目浮层（overlay 里渲染）
      destroy()
    }

`Api`（shell 提供）：

    Api = {
      state(from, to) -> Promise<State>,
      today() -> Promise<State.today>,
      lunar(dateKey) -> Promise<{text,month,day,leap,festivals}>,
      op(op, payload) -> Promise<State>,       // op 见 §3
      mode(mode) -> Promise<void>,
    }

日历页必须有的东西：

1. 月视图 7 列（周一为首）：格子里 公历日 + 农历小字（初一显示「X月」）+ 事件色点 + 未完成 DDL 计数徽标；今天高亮，非本月淡显。
2. 顶部工具栏：`‹ 2026年11月 ›`、`回到今天`、`+ 事件`、`+ DDL`、`形态切换`（调 `COACH.opts.onToggleMode`）。
3. 选中日详情：当天公历+农历、节日、事件（含「还有 3 天」「第 200 天」）、DDL 列表（勾选/删除/新增）。
4. 近期：未来 30 天的特殊日子倒计时列表（含农历、还有几天）。
5. 里程碑：锚点事件（`repeat:"yearly"` 或设置了 `anchorDate` 的纪念日）自动列出 100/200/300…1000 天、
   以及每周年的「N 周年」；点一下可"设为提醒"。
6. 新增/编辑事件表单：标题、公历/农历、每年重复、提前提醒（7/3/1/0 多选）、提醒时间。
7. 醒目提醒卡：顶部居中、大字号、红/金色强调、脉冲动画、「知道了」「10 分钟后再提醒」「打开日历」，可选提示音
   （WebAudio 三音，不用外部音频文件）与系统 Notification（首次申请权限）。

### 5.3 `shell`（src/shell.js，Lead 负责）

- 用 `ctx.inject(['slots'], ...)`（拿不到就退回 `ctx.slots`，再拿不到只保留浮动卡）注册三个座位：
  `sidebar.panellist`（图标行，id `dsh-calendar-coach`）、`main`（keyed，key 同 id，整页）、
  `shell.overlay`（提醒浮层宿主）。
- 卡片形态：`document.body` 上一个 fixed 层，里面 `COACH.mount(layer)` + `COACH.setMode('card')`。
- 整页形态：`main` 槽组件挂载时 `COACH.mount(pageEl)` + `COACH.setMode('page')` + `CAL.renderPane(...)`，
  同时隐藏卡片层（两者互斥，靠这层互斥实现"随时切换"）。
- 每 20s 轮询 `GET /pending`，新项交给 `CAL.showReminder`；`acked` 后 `POST /op reminder.ack`。

## 6. 分工（写作用域互不重叠）

| 负责人 | 写作用域 |
|---|---|
| Lead | `package.json`、`cordis.patch.yml`、`build.mjs`、`lib/**`、`src/shell.js`、`README.md`、`CONTRACT.md` |
| coach-merge | 只写 `src/coach.js`（+ 自己临时脚本，可删） |
| calendar-ui | 只写 `src/calendar.js`（+ 自己临时脚本，可删） |

任何一方需要改契约，先改本文件并在交付说明里写清楚。
