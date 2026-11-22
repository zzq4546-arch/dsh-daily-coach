/* dsh-calendar-coach — 提醒计算
 * 只做纯计算（不发消息）；投递由 lib/index.js 接 schedule 服务完成。
 */
import { addDays, diffDays, festivalsOf, nowLocal, parseKey, toDayNumber, todayKey, solarToLunar, WEEKDAY_NAMES, weekdayOf } from './lunar.js'
import { occurrences } from './recur.js'

const KEEP_MS = 60 * 24 * 3600 * 1000

/* 「设好之后至少过一小时才提醒」的兜底延迟：防止晚上新建一条当天到期的 DDL 时，
 * 提醒时间（默认 09:00）早就过去，于是立刻弹卡打扰用户。 */
const CREATED_DELAY_MS = 60 * 60 * 1000
const TZ = 'Asia/Shanghai'
const stampDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const stampTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

function stampOfMs(ms) {
  const d = new Date(ms)
  return stampDateFmt.format(d) + ' ' + stampTimeFmt.format(d)
}

/**
 * 把提醒时间抬到「创建时间 + delayMs」之后（两者取晚的）。
 * 用于 DDL：新建时就已过点的当天任务，改成创建后一小时再提醒，而不是立刻弹。
 */
export function notBeforeCreated(at, createdIso, delayMs) {
  if (!createdIso) return at
  const created = Date.parse(createdIso)
  if (!isFinite(created)) return at
  const floor = stampOfMs(created + (delayMs || CREATED_DELAY_MS))
  return floor > at ? floor : at
}

export function timeOf(ev, meta) {
  return (ev && ev.remindTime) || (meta && meta.remindTime) || '09:00'
}

function stamp(dateKey, hhmm) {
  return dateKey + ' ' + (hhmm || '09:00')
}

/** 某个时间点是否已到（字符串比较：'YYYY-MM-DD HH:mm' 可直接比） */
export function isDue(at, now) {
  return at <= stamp(now.key, now.time)
}

/** 事件提醒文本 */
function eventText(ev, occ, lead, dateKey) {
  const l = solarToLunar(dateKey)
  const when = lead > 0 ? ('还有 ' + lead + ' 天') : '就是今天'
  const head = when + '：' + ev.title
  const sub = occ.sub || ''
  const lunar = l ? '（' + l.text + '）' : ''
  return head + (sub ? ' · ' + sub : '') + lunar
}

/** 生成 [from, to] 区间内的提醒候选（未过滤已发） */
export function candidates(state, fromKey, toKey) {
  const list = []
  const meta = state.meta || {}
  const events = state.events || []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const occs = occurrences(ev, fromKey, toKey)
    for (let j = 0; j < occs.length; j++) {
      const occ = occs[j]
      const leads = (Array.isArray(ev.leadDays) && ev.leadDays.length) ? ev.leadDays : (meta.leadDays || [7, 1, 0])
      const t = timeOf(ev, meta)
      for (let k = 0; k < leads.length; k++) {
        const lead = leads[k]
        const d = addDays(occ.date, -lead)
        if (toDayNumber(d) < toDayNumber(fromKey)) continue
        const at = stamp(d, t)
        list.push({
          key: ev.id + '|' + occ.date + '|L' + lead,
          kind: 'event',
          id: ev.id,
          date: occ.date,
          at: at,
          lead: lead,
          dayN: occ.dayN,
          priority: (lead === 0 ? 'high' : (occ.kind === 'milestone' ? 'high' : 'normal')),
          title: ev.title,
          sub: occ.sub || '',
          text: eventText(ev, occ, lead, occ.date),
          chat: lead === 0 || occ.kind === 'milestone' || ev.type === 'birthday'
        })
      }
    }
  }
  const ddls = state.ddls || []
  const today = todayKey()
  for (let i = 0; i < ddls.length; i++) {
    const d = ddls[i]
    if (d.done) continue
    const t = d.time || '09:00'
    const at = notBeforeCreated(stamp(d.date, t), d.createdAt)
    if (toDayNumber(d.date) >= toDayNumber(fromKey)) {
      list.push({
        key: d.id + '|' + d.date + '|ddl',
        kind: 'ddl', id: d.id, date: d.date, at: at, lead: 0,
        priority: d.priority === 'high' ? 'high' : 'normal',
        title: d.title,
        sub: toDayNumber(d.date) === toDayNumber(today) ? '今天截止' : (d.time ? d.time + ' 截止' : '今天'),
        text: (d.time ? d.time + ' 截止：' : '今天要做：') + d.title,
        /* 带具体时间的 DDL 一律发聊天消息（否则用户只在早报里看到，到点没有任何提醒） */
        chat: !!d.time || d.priority === 'high'
      })
    }
    else if (toDayNumber(d.date) < toDayNumber(today)) {
      const overdueDays = diffDays(d.date, today)
      list.push({
        key: d.id + '|overdue|' + today,
        kind: 'ddl', id: d.id, date: d.date, at: notBeforeCreated(stamp(today, '09:05'), d.createdAt), lead: 0,
        priority: 'high',
        title: d.title,
        sub: '已逾期 ' + overdueDays + ' 天',
        text: '逾期 ' + overdueDays + ' 天还没做：' + d.title,
        chat: overdueDays >= 2
      })
    }
  }
  /* 定点提醒：几点做什么。repeat = once / daily / weekly；每天/每周会在区间内逐日展开。 */
  const alarms = state.alarms || []
  for (let i = 0; i < alarms.length; i++) {
    const a = alarms[i]
    if (!a || a.enabled === false) continue
    if (a.repeat === 'once' && !a.date) continue
    for (let k = 0; k <= 400; k++) {
      const day = addDays(fromKey, k)
      if (toDayNumber(day) > toDayNumber(toKey)) break
      if (a.repeat === 'once') {
        if (a.date !== day) continue
      }
      else if (a.repeat === 'weekly') {
        const wd = weekdayOf(day)
        const days = (Array.isArray(a.weekdays) && a.weekdays.length) ? a.weekdays : [1, 2, 3, 4, 5]
        if (days.indexOf(wd) < 0) continue
      }
      /* 定时提醒：如果创建/修改时今天的这个点已经过了，就跳过今天（从下一次开始），
         不要在一个奇怪的时刻补弹；「创建后一小时」的兜底对同一分钟内创建的情况仍然有效 */
      const nominal = stamp(day, a.time)
      if (a.createdAt) {
        const createdMs = Date.parse(a.createdAt)
        if (isFinite(createdMs) && nominal < stampOfMs(createdMs)) {
          if (a.repeat === 'once') break
          continue
        }
      }
      const at = notBeforeCreated(nominal, a.createdAt)
      list.push({
        key: a.id + '|' + day + '|alarm',
        kind: 'alarm', id: a.id, date: day, at: at, lead: 0,
        priority: 'high',
        title: a.title,
        sub: '⏰ ' + a.time,
        text: '到点了：' + a.title,
        chat: true
      })
      if (a.repeat === 'once') break
    }
  }
  list.sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0) })
  return list
}

/** 已经到点、还没发过的提醒 */
export function due(state, now) {
  const n = now || nowLocal()
  const from = addDays(n.key, -3)
  const list = candidates(state, from, addDays(n.key, 1))
  const fired = state.fired || {}
  const out = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c.at > (n.key + ' ' + n.time)) continue
    if (fired[c.key]) continue
    out.push(c)
  }
  return out
}

/** 即将到来的提醒（供 UI 的"接下来"列表） */
export function upcoming(state, now, days) {
  const n = now || nowLocal()
  const list = candidates(state, n.key, addDays(n.key, days || 30))
  const nowStamp = n.key + ' ' + n.time
  return list.filter(function (c) { return c.at >= nowStamp })
}

export function markFired(state, keys) {
  const now = Date.now()
  const fired = state.fired || {}
  for (let i = 0; i < keys.length; i++) fired[keys[i]] = now
  // 只保留 60 天
  const keep = {}
  Object.keys(fired).forEach(function (k) {
    const v = fired[k]
    if (typeof v === 'number' && now - v < KEEP_MS) keep[k] = v
  })
  state.fired = keep
  return state
}

/** 今日总览（给工具和 UI 用） */
export function todaySummary(state, key) {
  const k = key || todayKey()
  const evs = []
  const events = state.events || []
  for (let i = 0; i < events.length; i++) {
    const occs = occurrences(events[i], k, k)
    for (let j = 0; j < occs.length; j++) {
      evs.push({ id: events[i].id, title: events[i].title, sub: occs[j].sub, kind: events[i].type })
    }
  }
  const dueToday = (state.ddls || []).filter(function (d) { return d.date === k })
  const overdue = (state.ddls || []).filter(function (d) { return !d.done && d.date < k })
  const l = solarToLunar(k)
  return {
    date: k,
    weekday: WEEKDAY_NAMES[weekdayOf(k)],
    lunar: l ? l.text : '',
    festivals: festivalsOf(k),
    events: evs,
    ddls: dueToday,
    overdue: overdue
  }
}
