/* dsh-calendar-coach — 宿主端入口
 * 职责：持久化（calendar.json）、给模型注册日历工具、给浏览器端开 /api/dsh-calendar、
 *       把重要提醒通过宿主 schedule 服务投递进会话。
 */
import { load, paths, stats } from './store.js'
import { createHandler, PREFIX } from './api.js'
import { registerTools } from './tools.js'
import { attachSchedule, syncAll } from './runtime.js'
import { diag, diagObject } from './diag.js'

export const name = 'dsh-calendar-coach'
export const inject = ['tools']

/* 运行时优先用官方 defineTool；拿不到就传 null，让 tools.js 自己把 parameters 编译成 JSON Schema。
 * 注意不能退回一个“原样返回”的假函数：它会被当成官方 defineTool，作者简写（属性上挂 required:true）
 * 就会原样发给模型 API，报 Invalid schema for function。 */
let defineTool = null
try {
  const tools = await import('@deepseek-ai/dsh-tools')
  if (tools && typeof tools.defineTool === 'function') defineTool = tools.defineTool
}
catch (err) {
  try { console.warn('[dsh-calendar] 未拿到 defineTool，将自行编译 parameters：' + ((err && err.message) || err)) } catch (e) { /* ignore */ }
}

const SYNC_MS = 5 * 60 * 1000

export function apply(ctx) {
  diag('=== apply 开始 ===')
  try {
    diag('ctx 服务：tools=' + (ctx && ctx.tools ? typeof ctx.tools.register : 'none') +
      ' webServer=' + (ctx && ctx.get && ctx.get('webServer') ? 'yes' : 'no') +
      ' ctx.keys=' + (ctx ? Object.keys(ctx).slice(0, 30).join(',') : 'null'))
  } catch (e) { diag('ctx 探查失败：' + ((e && e.message) || e)) }

  load()
  diag('数据文件：' + paths.file)
  try { console.log('[dsh-calendar] 数据文件：' + paths.file + ' ' + JSON.stringify(stats())) } catch (e) { /* ignore */ }

  const toolReport = registerTools(ctx, defineTool)
  diag('工具注册结果：ok=' + toolReport.ok.length + ' failed=' + toolReport.failed.length)
  if (toolReport.failed.length) diagObject('失败明细：', toolReport.failed.map(function (f) { return { name: f.name, error: f.error } }))
  try {
    console.log('[dsh-calendar] 工具注册：' + toolReport.ok.length + ' 成功 / ' + toolReport.failed.length + ' 失败' +
      (toolReport.failed.length ? ' -> ' + toolReport.failed.map(function (f) { return f.name + ': ' + f.error }).join(' | ') : ''))
  } catch (e) { /* ignore */ }

  // 同源 HTTP 接口（浏览器端读写都走这里）
  ctx.inject(['webServer'], function (sc) {
    sc.effect(function () {
      const registered = sc.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: createHandler({ hooks: { afterWrite: function () { return syncAll() } } })
      })
      return function () {
        try {
          if (typeof registered === 'function') registered()
          else if (registered && typeof registered.dispose === 'function') registered.dispose()
        }
        catch (e) { /* ignore */ }
      }
    }, 'dsh-calendar-coach: routes')
  })

  // 提醒服务就绪后：接上 schedule，并做一次补发同步
  ctx.inject(['schedule'], function (sc) {
    attachSchedule(sc.schedule)
    syncAll().catch(function () { /* ignore */ })
  })

  // 周期兜底：即使没有新的写入，也把未来 14 天的聊天提醒补齐
  ctx.effect(function () {
    const timer = setInterval(function () {
      syncAll().catch(function () { /* ignore */ })
    }, SYNC_MS)
    return function () { clearInterval(timer) }
  }, 'dsh-calendar-coach: sync timer')
}
