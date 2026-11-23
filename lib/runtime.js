/* dsh-calendar-coach — 运行时桥：把提醒投递进会话（走宿主 schedule 服务）
 * 说明：只有宿主在运行时才能投递；页面开着时的浮层提醒由 client 轮询 /pending 完成。
 */
import { get, update } from './store.js'
import { addDays, nowLocal, todayKey } from './lunar.js'
import { candidates } from './reminders.js'
import { diag } from './diag.js'

export const rt = {
  schedule: null,
  log: []
}

function note(msg) {
  rt.log.push(new Date().toISOString() + ' ' + msg)
  if (rt.log.length > 50) rt.log.shift()
  try { console.log('[dsh-calendar] ' + msg) } catch (e) { /* ignore */ }
  try { diag(msg) } catch (e) { /* ignore */ }
}

export function attachSchedule(svc) {
  rt.schedule = svc || null
  note(svc ? 'schedule 服务已就绪' : 'schedule 服务不可用')
}

/* 与宿主 schedule 服务交互的兼容层。
 * DSH 0.2.2 起接口变成：
 *   create({ title, prompt, timing:{kind,<selector>}, target:{kind:'session',sessionId} }, actorSessionId)
 *   edit({ action:'delete', id })
 *   list() -> { items:[ {...record, target, status} ] }
 * 旧版是 create(sessionId, { title, prompt, at|daily }) / delete({ sessionId, id }) / list -> 数组，
 * 这里两边都试一遍，谁先成功用谁。 */
async function listRecords(sessionId) {
  if (!rt.schedule || typeof rt.schedule.list !== 'function') return []
  const page = await rt.schedule.list({})
  const arr = Array.isArray(page) ? page : (page && Array.isArray(page.items) ? page.items : [])
  return arr.filter(function (e) {
    const sid = (e && e.target && e.target.sessionId) || (e && e.sessionId)
    return !sid || sid === sessionId
  })
}

/* 记录里带 [[cal:<key>]] 标记；不再需要的（事件被删/改期）就按标记删掉 */
async function pruneChatRecords(sessionId, wanted) {
  let removed = 0
  try {
    const list = await listRecords(sessionId)
    for (let i = 0; i < list.length; i++) {
      const rec = list[i]
      const m = String((rec && rec.prompt) || '').match(/\[\[cal:([^\]]+)\]\]/)
      if (!m || wanted[m[1]]) continue
      if (await removeRecord(sessionId, rec.id)) removed++
    }
  }
  catch (e) { note('校准聊天提醒失败：' + ((e && e.message) || e)) }
  return removed
}

function sessionOf() {
  const s = get()
  const id = s.meta && s.meta.notifySessionId
  return id ? String(id) : null
}

async function createRecord(sessionId, payload) {
  if (!rt.schedule || !sessionId) return null
  try {
    const rec = await rt.schedule.create({
      title: payload.title,
      prompt: payload.prompt,
      timing: payload.timing,
      target: { kind: 'session', sessionId: sessionId }
    }, sessionId)
    if (rec && rec.id) return rec
  }
  catch (err) {
    note('新版 schedule.create 失败：' + ((err && err.message) || err))
  }
  const legacy = { title: payload.title, prompt: payload.prompt }
  if (payload.timing && payload.timing.kind === 'at') legacy.at = payload.timing.at
  if (payload.timing && payload.timing.kind === 'daily') legacy.daily = payload.timing.daily
  try {
    return await rt.schedule.create(sessionId, legacy)
  }
  catch (err2) {
    note('创建提醒失败：' + ((err2 && (err2.code || err2.message)) || err2))
    return null
  }
}

async function removeRecord(sessionId, id) {
  if (!rt.schedule || !id) return false
  try {
    const out = await rt.schedule.edit({ action: 'delete', id: id }, sessionId)
    if (out === undefined || (out && out.deleted !== false)) return true
  }
  catch (e1) { /* 旧版没有 edit */ }
  try { await rt.schedule.delete({ sessionId: sessionId, id: id }); return true }
  catch (err) { note('删除提醒失败：' + ((err && err.message) || err)); return false }
}

/** 每日早报：一条 daily 记录，触发时让 agent 自己念一遍今天 */
export async function ensureDigest() {
  const s = get()
  const meta = s.meta || {}
  const sessionId = sessionOf()
  if (!sessionId || !meta.digest || !meta.digest.on) return { ok: false, reason: 'no-session-or-off' }
  const want = meta.digest.time || '08:00'
  const rec = meta.digestRecord
  if (rec && rec.scheduleId && rec.sessionId === sessionId && rec.time === want) return { ok: true, reused: true }
  if (rec && rec.scheduleId) await removeRecord(rec.sessionId, rec.scheduleId)
  const created = await createRecord(sessionId, {
    title: '日历早报 ' + want,
    prompt: '【日历早报】请先调用 calendar_today 看今天，然后用 3-6 行把今天的 DDL、纪念日/生日、农历节日说清楚：先说最要紧的一件事，逾期的事单独点出来，最后提醒下一个值得纪念的日子。语气简短自然。',
    /* DSH 0.2.2 起 schedule.create 的请求体改成 { title, prompt, timing: { kind, <selector> } } */
    timing: { kind: 'daily', daily: { time: want.length === 5 ? want + ':00' : want, time_zone: 'Asia/Shanghai' } }
  })
  if (!created) return { ok: false, reason: 'create-failed' }
  await update(function (st) {
    st.meta.digestRecord = { sessionId: sessionId, scheduleId: created.id, time: want, at: new Date().toISOString() }
  })
  note('早报已排定 ' + want + '（' + created.id + '）')
  return { ok: true, id: created.id }
}

/** 重要节点的聊天提醒：为未来 14 天内需要发消息的提醒各建一条一次性记录 */
export async function ensureChatReminders() {
  const s = get()
  const sessionId = sessionOf()
  if (!sessionId) return { ok: false, reason: 'no-session' }
  if (s.meta && s.meta.notify === false) return { ok: false, reason: 'off' }
  const now = nowLocal()
  const horizon = addDays(now.key, 14)
  const list = candidates(s, addDays(now.key, -1), horizon)
  const nowStamp = now.key + ' ' + now.time
  const scheduled = s.scheduled || {}
  const wanted = {}
  let created = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (!c.chat) continue
    if (c.at < nowStamp) continue
    wanted[c.key] = true
    if (scheduled[c.key]) continue
    /* 用候选自己的触发时刻（c.at）而不是事件发生日（c.date）：
       提前 7 天/1 天的提醒本来就该在提前那天发 */
    const parts = String(c.at).split(' ')
    const at = parts[0] + 'T' + (parts[1] || '09:00') + ':00+08:00'
    const rec = await createRecord(sessionId, {
      title: '日历提醒 · ' + c.title,
      prompt: '【日历提醒】' + c.text + '\n请用一两句话把这件事直接告诉我，不要寒暄，不要复述这条提示。\n[[cal:' + c.key + ']]',
      timing: { kind: 'at', at: at }
    })
    if (rec) {
      created++
      await update(function (st) {
        st.scheduled[c.key] = { scheduleId: rec.id, at: c.at, sessionId: sessionId }
      })
    }
  }
  // 校准：用 schedule 服务的真实清单删掉已经不需要的提醒（用户删了纪念日/改了日期时）
  const removed = await pruneChatRecords(sessionId, wanted)
  if (removed) note('清理 ' + removed + ' 条失效聊天提醒')
  // 本地指针只保留仍然有效的，避免下次重复创建
  const keys = Object.keys(scheduled)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (!wanted[k]) await update(function (st) { delete st.scheduled[k] })
  }
  if (created) note('新增 ' + created + ' 条聊天提醒')
  return { ok: true, created: created }
}

/** 全量同步（写完数据后调用） */
export async function syncAll() {
  try { await ensureChatReminders() } catch (e) { note('sync reminders 失败 ' + e) }
  try { await ensureDigest() } catch (e) { note('sync digest 失败 ' + e) }
}

/** 绑定/解绑会话后调用 */
export async function followUp(kind) {
  if (kind === 'calendar_bind') {
    await syncAll()
    return { note: '' }
  }
  await syncAll()
  return { note: '' }
}

export function status() {
  const s = get()
  return {
    schedule: !!rt.schedule,
    session: sessionOf(),
    notify: !(s.meta && s.meta.notify === false),
    digest: s.meta && s.meta.digest,
    scheduled: Object.keys(s.scheduled || {}).length,
    log: rt.log.slice(-10)
  }
}

export { todayKey }
