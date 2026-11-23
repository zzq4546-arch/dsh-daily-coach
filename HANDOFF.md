# dsh-calendar-coach 部署与维护交接

2026-11-23，北京时间。桌面 DSH 已加载学习计划补丁和悬浮入口修复。继续开发时，从 `src/` 修改浏览器逻辑，再构建 `client.js`。宿主端负责日历、DDL、提醒和考试日期导入。

## 本次修改

- [src/focus.js](src/focus.js) 新增「今天」页，展示阶段任务、本周待办、运动和饮食记录、考试日期。原每日任务入口叫「打卡」，继续读取原有记录。
- [lib/focus-dates.js](lib/focus-dates.js) 和 [lib/api.js](lib/api.js) 增加 6 场期末考试，以及可选的六级和蓝桥杯日期。页面读取 `GET /api/dsh-calendar/focus`。用户点击「导入到日历」才通过 `POST /api/dsh-calendar/op` 的 `importFocusDates` 操作写入高优先级 DDL。导入会跳过已有或已过期的条目，并返回三类数量。[src/shell.js](src/shell.js) 在导入完成后刷新日历。
- [src/coach.js](src/coach.js) 修复收起后的「今日」胶囊卡在 Windows 标题栏的问题。原来允许保存距顶部 8px 的坐标，胶囊进入原生标题栏后，鼠标事件被窗口接管。浮卡和胶囊现在都使用 `-webkit-app-region: no-drag`，并共用 64 CSS px 的顶部安全距离。加载旧坐标、拖动或缩放窗口时都会重新限位。[build.mjs](build.mjs) 将 `focus`、`coach`、`calendar` 和 `shell` 四个片段构建为 `client.js`。

## 数据与备份

- 日历、DDL 和定点提醒保存在 `D:\DSH\home\calendar\calendar.json`。桌面打卡、复盘和笔记保存在 `dsh-app://app` 的 `localStorage` 键 `dsh-daily-coach.v2`，每日教练计划使用 `dsh-daily-coach.plan.v1`。旧 `.v1` 键用于兼容。
- 补丁部署后核实了 12 条事件、19 条 DDL、1 条定点提醒和 16 天打卡。悬浮修复验收后，日历文件校验值和已有打卡及计划内容再次核对一致。鼠标验收保存了胶囊的位置，验收结束时胶囊处于收起状态。
- 完整备份位于 `C:\Users\32354\AppData\Local\DSH\calendar-coach-backups\20261123-221155-430195`，包含部署前的插件文件、日历和桌面 Local Storage。它对应最初的补丁部署前。若只需撤回悬浮修复，撤回 `src/coach.js` 中的顶部限位和 `no-drag` 样式，再重新构建。

## 构建与验收

本机桌面 profile 的 `D:\DSH\home\profiles\desktop\node_modules\dsh-calendar-coach` 是指向本目录的 Junction。构建后重启桌面 DSH，使用实际桌面进程的回环端口检查接口。

```powershell
node build.mjs
node --check client.js
node _scratch/http-test.mjs
```

HTTP 自检会使用临时 `DSH_HOME`。桌面验收时，用 `x-dsh-calendar: 1` 请求 `/api/dsh-calendar/health` 和 `/api/dsh-calendar/focus`，检查 HTTP 200、`ok`、6 条期末日期，以及界面中的「今天」和「打卡」。查 `D:\DSH\home\calendar\register.log` 可确认 8 个日历工具的注册结果。

这次在 Windows 实际 DSH 窗口中用鼠标验证了展开、收起、拖动，以及推到顶部限位后再次点击。在隔离的 Electron 窄窗口中，也验证了旧的贴顶坐标会在加载时恢复到可用范围。

## 后续改进顺序

1. 把悬浮入口验收做成 Windows 桌面回归。覆盖旧坐标、最大化与还原、不同 DPI 和多显示器。可沿用 DSH 提供的标题栏高度变量来计算安全距离，检查各窗口状态下鼠标能否真正命中入口。
2. 把 `lib/focus-dates.js` 的日期及 `src/focus.js` 的阶段边界移到学期配置。当前导入 ID 只按日期生成，扩展前应为同一天的多场考试设计稳定的独立 ID，并验证旧记录去重。
3. 在下一次发版时同步 README、CONTRACT、CHANGELOG 和包版本。补上第四个前端片段、考试日期接口和桌面验收步骤。
