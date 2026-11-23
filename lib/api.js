/* dsh-calendar-coach — 宿主 HTTP 接口（浏览器端同源调用）
 * 前缀 /api/dsh-calendar
 * 防护：必须带 x-dsh-calendar: 1；带 Origin 时必须与 Host 一致（挡掉任意网页的 CSRF）
 */
import * as ops from './ops.js'
import * as reminders from './reminders.js'
import * as store from './store.js'
import { todayKey } from './lunar.js'
import { focusDates, importFocusDates } from './focus-dates.js'

const PREFIX = '/api/dsh-calendar'
const MAX_BODY = 256 * 1024

function json(res, code, body) {
  const txt = JSON.stringify(body)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(txt)
}

function forbidden(req) {
  const origin = req.headers && req.headers.origin
  if (!origin) return false
  try {
    const u = new URL(origin)
    const host = req.headers.host || ''
    return u.host !== host
  }
  catch (e) { return true }
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0
    const chunks = []
    req.on('data', function (c) {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error('JSON 解析失败')) }
    })
    req.on('error', reject)
  })
}

const OPS = {
  importFocusDates: importFocusDates,
  addEvent: function (p) { return ops.addEvent(p) },
  updateEvent: function (p) { return ops.updateEvent(p) },
  deleteEvent: function (p) { return ops.deleteEvent(p && p.id) },
  addDdl: function (p) { return ops.addDdl(p) },
  updateDdl: function (p) { return ops.updateDdl(p) },
  deleteDdl: function (p) { return ops.deleteDdl(p && p.id) },
  addAlarm: function (p) { return ops.addAlarm(p) },
  updateAlarm: function (p) { return ops.updateAlarm(p) },
  deleteAlarm: function (p) { return ops.deleteAlarm(p && p.id) },
  setMode: function (p) { return ops.setMode(p && p.mode) },
  bindSession: function (p) { return ops.bindSession(p && p.sessionId) },
  markFired: function (p) { return ops.markFired((p && p.keys) || []) }
}

/* 浏览器端（CAL）按契约用点号命名，这里给同一批操作起别名，省掉一次失败请求 */
OPS['event.add'] = OPS.addEvent
OPS['event.update'] = OPS.updateEvent
OPS['event.delete'] = OPS.deleteEvent
OPS['ddl.add'] = OPS.addDdl
OPS['ddl.update'] = OPS.updateDdl
OPS['ddl.toggle'] = OPS.updateDdl
OPS['ddl.delete'] = OPS.deleteDdl
OPS['alarm.add'] = OPS.addAlarm
OPS['alarm.update'] = OPS.updateAlarm
OPS['alarm.delete'] = OPS.deleteAlarm
/* 提醒卡的"知道了/10 分钟后再提醒"：ack 直接标记已提醒；snooze 由浏览器端本地定时重弹 */
OPS['reminder.ack'] = function (p) { return ops.markFired((p && p.keys) || []) }
OPS['reminder.snooze'] = function () { return Promise.resolve(true) }

export function createHandler(opts) {
  const hooks = opts && opts.hooks ? opts.hooks : {}
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname
    if (path.indexOf(PREFIX) !== 0) return json(res, 404, { ok: false, error: 'not found' })
    if (forbidden(req)) return json(res, 403, { ok: false, error: 'origin' })
    const hasHeader = String((req.headers && req.headers['x-dsh-calendar']) || '') === '1'
    const isGet = req.method === 'GET'

    const rest = path.slice(PREFIX.length) || '/'
    try {
      if (isGet) {
        if (!hasHeader && rest !== '/health') return json(res, 400, { ok: false, error: 'missing header' })
        if (rest === '/health') return json(res, 200, { ok: true, service: 'dsh-calendar-coach' })
        if (rest === '/state') {
          const from = url.searchParams.get('from') || undefined
          const to = url.searchParams.get('to') || undefined
          return json(res, 200, { ok: true, data: ops.stateView(from, to) })
        }
        if (rest === '/today') {
          // 今天的完整摘要（农历、节日、当日事件、到期/逾期 DDL）+ 一段中文文案
          const key = url.searchParams.get('date') || todayKey()
          const state = await store.load()
          const summary = reminders.todaySummary(state, key)
          return json(res, 200, { ok: true, data: Object.assign({}, summary, { text: ops.todayText(key) }) })
        }
        if (rest === '/lunar') {
          const d = url.searchParams.get('date')
          return json(res, 200, { ok: true, data: ops.lunarView(d || undefined) })
        }
        if (rest === '/pending') return json(res, 200, { ok: true, data: ops.pendingView() })
        if (rest === '/focus') return json(res, 200, { ok: true, data: focusDates() })
        if (rest === '/upcoming') return json(res, 200, { ok: true, data: ops.upcomingView(+url.searchParams.get('days') || 30) })
        return json(res, 404, { ok: false, error: 'unknown route ' + rest })
      }

      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' })
      if (!hasHeader) return json(res, 400, { ok: false, error: 'missing header' })
      const body = await readBody(req)
      if (rest === '/op') {
        const fn = OPS[body.op]
        if (!fn) return json(res, 400, { ok: false, error: 'unknown op ' + body.op })
        const result = await fn(body.payload || {})
        if (hooks.afterWrite) { try { await hooks.afterWrite() } catch (e) { /* ignore */ } }
        return json(res, 200, { ok: true, data: result, state: ops.stateView() })
      }
      if (rest === '/mode') {
        const m = await ops.setMode(body.mode)
        return json(res, 200, { ok: true, data: m })
      }
      return json(res, 404, { ok: false, error: 'unknown route ' + rest })
    }
    catch (err) {
      return json(res, 200, { ok: false, error: String((err && err.message) || err) })
    }
  }
}

export { PREFIX }
