/* dsh-calendar-coach — 业务操作（工具与 HTTP 共用同一套） */
import { get, update, newId } from './store.js'
import {
  addDays, diffDays, isValidKey, keyOf, nowLocal, parseKey, solarToLunar,
  todayKey, festivalsOf, constellationOf, humanDate, weekdayOf, WEEKDAY_NAMES
} from './lunar.js'
import { nextOccurrence, occurrences, parseLeads } from './recur.js'
import { candidates, todaySummary, upcoming } from './reminders.js'

export function normalizeDate(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return null
  let m = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/.exec(s)
  if (m) return keyOf(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/月.](\d{1,2})日?$/.exec(s)
  if (m) return keyOf(parseKey(todayKey()).y, +m[1], +m[2])
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return keyOf(+m[1], +m[2], +m[3])
  return null
}

function badDate(v) {
  return new Error('看不懂这个日期：' + v + '。请用 2026-03-14 这种写法')
}

export function addEvent(payload) {
  const p = payload || {}
  const title = String(p.title || '').trim()
  if (!title) throw new Error('需要给这个日子起个名字（title）')
  const calendar = p.calendar === 'lunar' ? 'lunar' : 'solar'
  let start = normalizeDate(p.date || p.start)
  if (!start || !isValidKey(start)) throw badDate(p.date || p.start)
  let lunar = null
  if (calendar === 'lunar') {
    if (p.lunarMonth && p.lunarDay) {
      lunar = { month: +p.lunarMonth, day: +p.lunarDay, isLeap: !!p.lunarIsLeap }
    }
    else {
      const l = solarToLunar(start)
      if (!l) throw new Error('这个日期换算不出农历，请直接给 lunarMonth / lunarDay')
      lunar = { month: l.month, day: l.day, isLeap: l.isLeap }
    }
    if (lunar.month < 1 || lunar.month > 12 || lunar.day < 1 || lunar.day > 30) {
      throw new Error('农历月份 1-12、日期 1-30')
    }
  }
  const type = ['anniversary', 'birthday', 'festival', 'custom'].includes(p.type) ? p.type : 'anniversary'
  const repeat = p.repeat === 'once' ? 'once' : 'yearly'
  const leads = p.leadDays != null && p.leadDays !== '' ? parseLeads(p.leadDays) : null
  return update(function (s) {
    const ev = {
      id: newId('ev'),
      title: title,
      type: type,
      calendar: calendar,
      start: start,
      repeat: repeat,
      leadDays: leads && leads.length ? leads : null,
      remindTime: /^\d{1,2}:\d{2}$/.test(String(p.remindTime || '')) ? String(p.remindTime) : null,
      milestones: p.milestones !== false && p.milestones !== 'false',
      note: String(p.note || ''),
      tag: String(p.tag || ''),
      createdAt: new Date().toISOString()
    }
    if (lunar) ev.lunar = lunar
    s.events.push(ev)
    return ev
  })
}

export function updateEvent(payload) {
  const p = payload || {}
  const id = String(p.id || '')
  if (!id) throw new Error('缺少 id')
  return update(function (s) {
    const ev = s.events.find(function (e) { return e.id === id })
    if (!ev) throw new Error('没找到这个日子：' + id)
    if (p.title != null) ev.title = String(p.title)
    if (p.type != null) ev.type = p.type
    if (p.date != null) {
      const d = normalizeDate(p.date)
      if (!d || !isValidKey(d)) throw badDate(p.date)
      ev.start = d
      if (ev.calendar === 'lunar') {
        const l = solarToLunar(d)
        if (l) ev.lunar = { month: l.month, day: l.day, isLeap: l.isLeap }
      }
    }
    if (p.calendar != null) {
      ev.calendar = p.calendar === 'lunar' ? 'lunar' : 'solar'
      if (ev.calendar === 'lunar') {
        const l = solarToLunar(ev.start)
        if (l) ev.lunar = { month: l.month, day: l.day, isLeap: l.isLeap }
      }
      else delete ev.lunar
    }
    if (p.repeat != null) ev.repeat = p.repeat === 'once' ? 'once' : 'yearly'
    if (p.leadDays != null) {
      const leads = parseLeads(p.leadDays)
      ev.leadDays = leads.length ? leads : null
    }
    if (p.remindTime != null) ev.remindTime = /^\d{1,2}:\d{2}$/.test(String(p.remindTime)) ? String(p.remindTime) : null
    if (p.milestones != null) ev.milestones = p.milestones === true || p.milestones === 'true'
    if (p.note != null) ev.note = String(p.note)
    if (p.tag != null) ev.tag = String(p.tag)
    return ev
  })
}

export function deleteEvent(id) {
  return update(function (s) {
    const i = s.events.findIndex(function (e) { return e.id === id })
    if (i < 0) throw new Error('没找到这个日子：' + id)
    const ev = s.events[i]
    s.events.splice(i, 1)
    // 清掉它的提醒记录
    Object.keys(s.fired || {}).forEach(function (k) { if (k.indexOf(id + '|') === 0) delete s.fired[k] })
    Object.keys(s.scheduled || {}).forEach(function (k) { if (k.indexOf(id + '|') === 0) delete s.scheduled[k] })
    return ev
  })
}

export function addDdl(payload) {
  const p = payload || {}
  const title = String(p.title || '').trim()
  if (!title) throw new Error('需要写清楚要做什么（title）')
  const date = normalizeDate(p.date)
  if (!date || !isValidKey(date)) throw badDate(p.date)
  return update(function (s) {
    const ddl = {
      id: newId('dl'),
      date: date,
      time: /^\d{1,2}:\d{2}$/.test(String(p.time || '')) ? String(p.time) : null,
      title: title,
      done: false,
      doneAt: null,
      priority: ['low', 'normal', 'high'].includes(p.priority) ? p.priority : 'normal',
      note: String(p.note || ''),
      createdAt: new Date().toISOString()
    }
    s.ddls.push(ddl)
    return ddl
  })
}

export function updateDdl(payload) {
  const p = payload || {}
  const id = String(p.id || '')
  if (!id) throw new Error('缺少 id')
  return update(function (s) {
    const d = s.ddls.find(function (x) { return x.id === id })
    if (!d) throw new Error('没找到这条任务：' + id)
    if (p.date != null) {
      const dd = normalizeDate(p.date)
      if (!dd || !isValidKey(dd)) throw badDate(p.date)
      d.date = dd
    }
    if (p.time != null) d.time = /^\d{1,2}:\d{2}$/.test(String(p.time)) ? String(p.time) : null
    if (p.title != null) d.title = String(p.title)
    if (p.priority != null) d.priority = p.priority
    if (p.note != null) d.note = String(p.note)
    if (p.done != null) {
      d.done = p.done === true || p.done === 'true' || p.done === 1
      d.doneAt = d.done ? new Date().toISOString() : null
    }
    return d
  })
}

export function deleteDdl(id) {
  return update(function (s) {
    const i = s.ddls.findIndex(function (x) { return x.id === id })
    if (i < 0) throw new Error('没找到这条任务：' + id)
    const d = s.ddls[i]
    s.ddls.splice(i, 1)
    return d
  })
}

export function setMode(mode) {
  return update(function (s) {
    s.meta.mode = mode === 'page' ? 'page' : 'card'
    return s.meta.mode
  })
}

export function bindSession(sessionId) {
  return update(function (s) {
    s.meta.notifySessionId = String(sessionId)
    return s.meta
  })
}

export function setNotify(on) {
  return update(function (s) {
    s.meta.notify = !!on
    return s.meta
  })
}

/* ---------------- 读 ---------------- */

export function stateView(fromKey, toKey) {
  const s = get()
  const f = fromKey || addDays(todayKey(), -60)
  const t = toKey || addDays(todayKey(), 120)
  const evs = s.events.map(function (ev) {
    const occ = occurrences(ev, f, t).map(function (o) {
      return { date: o.date, dateKey: o.date, kind: o.kind, sub: o.sub, label: o.label, dayN: o.dayN, yearN: o.yearN }
    })
    const next = nextOccurrence(ev, todayKey(), 800)
    const lunar = ev.lunar || null
    return {
      id: ev.id, title: ev.title, type: ev.type, calendar: ev.calendar, start: ev.start,
      repeat: ev.repeat, leadDays: ev.leadDays, remindTime: ev.remindTime, milestones: ev.milestones,
      note: ev.note, tag: ev.tag, lunar: lunar,
      /* 浏览器端（CAL）用的兼容字段：date/anchorDate 用 start，农历拆成平铺字段 */
      date: ev.start,
      anchorDate: ev.start,
      startDate: ev.start,
      lunarMonth: lunar ? lunar.month : null,
      lunarDay: lunar ? lunar.day : null,
      lunarLeap: lunar ? !!lunar.isLeap : false,
      occurrences: occ,
      next: next,
      daysUntilNext: next ? diffDays(todayKey(), next.date) : null
    }
  })
  return {
    rev: s.rev,
    mode: s.meta.mode,
    meta: s.meta,
    from: f,
    to: t,
    events: evs,
    ddls: s.ddls.slice(),
    today: todaySummary(s, todayKey()),
    upcoming: upcomingEvents(s, 31),
    now: nowLocal()
  }
}

/** 未来 N 天的事件发生（含里程碑），给浏览器端的「接下来」列表补充 */
function upcomingEvents(s, days) {
  const from = todayKey()
  const to = addDays(from, days || 31)
  const out = []
  const list = s.events || []
  for (let i = 0; i < list.length; i++) {
    const ev = list[i]
    const occs = occurrences(ev, from, to)
    for (let j = 0; j < occs.length; j++) {
      const o = occs[j]
      out.push({
        dateKey: o.date,
        title: o.label || ev.title,
        kind: o.kind === 'milestone' ? 'milestone' : (ev.type === 'festival' ? 'festival' : 'event'),
        lunarText: o.kind === 'milestone' ? (o.sub || '') : (o.sub || ''),
        sub: o.sub || ''
      })
    }
  }
  out.sort(function (a, b) { return toDayNumber(a.dateKey) - toDayNumber(b.dateKey) })
  return out
}

export function lunarView(dateKey) {
  const l = solarToLunar(dateKey)
  const p = parseKey(dateKey)
  return {
    date: dateKey,
    weekday: p ? WEEKDAY_NAMES[weekdayOf(dateKey)] : '',
    lunar: l,
    festivals: festivalsOf(dateKey),
    constellation: constellationOf(dateKey),
    human: humanDate(dateKey)
  }
}

export function upcomingView(days) {
  const s = get()
  return upcoming(s, nowLocal(), days || 30)
}

export function pendingView() {
  const now = nowLocal()
  const s = get()
  const all = candidates(s, addDays(now.key, -3), addDays(now.key, 1))
  const fired = s.fired || {}
  const out = []
  for (let i = 0; i < all.length; i++) {
    const c = all[i]
    if (c.at > (now.key + ' ' + now.time)) continue
    if (fired[c.key]) continue
    out.push(c)
  }
  return { now: now, items: out }
}

export function markFired(keys) {
  const now = Date.now()
  return update(function (s) {
    const fired = s.fired || {}
    for (let i = 0; i < keys.length; i++) fired[keys[i]] = now
    s.fired = fired
    return true
  })
}

export function todayText(dateKey) {
  const k = dateKey || todayKey()
  const s = get()
  const sum = todaySummary(s, k)
  const lines = []
  const p = parseKey(k)
  lines.push(humanDate(k) + '（农历 ' + (sum.lunar || '?') + (sum.festivals.length ? '，' + sum.festivals.join('、') : '') + '）')
  if (sum.events.length) {
    lines.push('今天要纪念的日子：')
    sum.events.forEach(function (e) { lines.push('  · ' + e.title + (e.sub ? '（' + e.sub + '）' : '') + '（' + e.id + '）') })
  }
  if (sum.ddls.length) {
    lines.push('今天的 DDL：')
    sum.ddls.forEach(function (d) {
      lines.push('  ' + (d.done ? '☑' : '☐') + ' ' + (d.time ? d.time + ' ' : '') + d.title + (d.priority === 'high' ? ' [重要]' : '') + '（' + d.id + '）')
    })
  }
  if (sum.overdue.length) {
    lines.push('逾期的：')
    sum.overdue.forEach(function (d) { lines.push('  ⚠ ' + d.date + ' ' + d.title + '（' + d.id + '）') })
  }
  const next = upcoming(s, nowLocal(), 30)
  if (next.length) {
    lines.push('接下来 30 天：')
    next.slice(0, 8).forEach(function (c) { lines.push('  ' + c.at + ' ' + c.title + (c.sub && c.kind !== 'ddl' ? '（' + c.sub + '）' : '')) })
  }
  if (lines.length === 1) lines.push('今天没有安排，清净。')
  return lines.join('\n')
}
