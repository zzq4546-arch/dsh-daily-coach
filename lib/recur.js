/* dsh-calendar-coach — 重复规则展开（纪念日 / 生日 / 节日 / 里程碑天数） */
import {
  addDays, diffDays, keyOf, parseKey, isValidKey, solarToLunar, lunarToSolar,
  toDayNumber, constellationOf
} from './lunar.js'

/* 值得纪念的天数：整百、一年/两年/三年、520、1314 等 */
export const MILESTONES = (function () {
  const set = []
  for (let n = 100; n <= 1000; n += 100) set.push(n)
  set.push(365, 520, 730, 999, 1095, 1314, 1461, 1826, 2000, 2190, 2555, 3000, 3650)
  return set.sort(function (a, b) { return a - b })
})()

const MILESTONE_NOTE = {
  365: '一周年',
  520: '我爱你',
  730: '两周年',
  999: '长长久久',
  1095: '三周年',
  1314: '一生一世',
  1461: '四周年',
  1826: '五周年',
  2190: '六周年',
  2555: '七周年',
  3650: '十周年'
}

export function parseLeads(v) {
  if (Array.isArray(v)) return v.filter(function (n) { return typeof n === 'number' && n >= 0 })
  if (typeof v === 'string') {
    return v.split(/[,，\s]+/).map(function (x) { return parseInt(x, 10) })
      .filter(function (n) { return typeof n === 'number' && n >= 0 && isFinite(n) })
  }
  return []
}

/** 事件在 [from, to] 区间内的所有发生日（不含里程碑） */
export function annualDates(ev, fromKey, toKey) {
  const out = []
  const p = parseKey(ev.start)
  if (!p) return out
  const f = parseKey(fromKey), t = parseKey(toKey)
  if (!f || !t) return out
  if (ev.repeat !== 'yearly') {
    if (toDayNumber(ev.start) >= toDayNumber(fromKey) && toDayNumber(ev.start) <= toDayNumber(toKey)) out.push(ev.start)
    return out
  }
  for (let y = f.y - 1; y <= t.y + 1; y++) {
    let k = null
    if (ev.calendar === 'lunar' && ev.lunar) {
      k = lunarToSolar(y, ev.lunar.month, ev.lunar.day, ev.lunar.isLeap)
      // 腊月三十遇到只有 29 天的年份，退到廿九
      if (!k && ev.lunar.month === 12 && ev.lunar.day === 30) k = lunarToSolar(y, 12, 29, false)
      if (!k && ev.lunar.day === 30) k = lunarToSolar(y, ev.lunar.month, 29, ev.lunar.isLeap)
    }
    else {
      k = keyOf(y, p.m, p.d)
      if (!isValidKey(k)) k = keyOf(y, p.m, p.d - 1) // 2 月 29 日在平年落到 2 月 28 日
    }
    if (k && isValidKey(k) && toDayNumber(k) >= toDayNumber(fromKey) && toDayNumber(k) <= toDayNumber(toKey)) out.push(k)
  }
  return out
}

/** 从 start 起算第 n 天对应的日期（n 从 1 开始） */
export function dayOfNth(ev, n) { return addDays(ev.start, n - 1) }

/** 事件在 [from, to] 区间内的里程碑日 */
export function milestoneDates(ev, fromKey, toKey) {
  const out = []
  if (!ev.milestones) return out
  if (ev.type === 'birthday' || ev.type === 'festival') return out
  const startN = toDayNumber(ev.start)
  if (!isFinite(startN)) return out
  for (let i = 0; i < MILESTONES.length; i++) {
    const n = MILESTONES[i]
    const k = fromDay(startN + n - 1)
    if (toDayNumber(k) >= toDayNumber(fromKey) && toDayNumber(k) <= toDayNumber(toKey)) out.push({ date: k, dayN: n })
  }
  return out
}

function fromDay(n) {
  const dt = new Date(n * 86400000)
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** 事件在某天的描述（周年 / 生日 / 第 N 天） */
export function describe(ev, dateKey) {
  const p = parseKey(ev.start)
  const c = parseKey(dateKey)
  if (!p || !c) return { label: ev.title, kind: 'event' }
  const dayN = diffDays(ev.start, dateKey) + 1
  const yearN = c.y - p.y
  let label = ev.title
  let sub = ''
  if (ev.type === 'birthday') {
    sub = yearN > 0 ? yearN + ' 岁生日' : '生日'
  }
  else if (ev.type === 'festival') {
    sub = '节日'
  }
  else if (dayN > 0) {
    /* 周年按"月日对上年月"算，可能比 365×N 差一天（闰年、起算含当天），
     * 用「月日相同」优先、农历事件退化为 ±1 天窗口，避免一周年报两次。 */
    const annivDay = yearN > 0 ? 365 * yearN + 1 : 0
    const sameMonthDay = c.m === p.m && c.d === p.d
    const nearAnniv = yearN > 0 && Math.abs(dayN - annivDay) <= 1
    const isAnniv = yearN > 0 && (sameMonthDay || (ev.calendar === 'lunar' && nearAnniv))
    if (isAnniv) sub = '第 ' + dayN + ' 天 · ' + yearN + ' 周年'
    else if (nearAnniv) sub = '第 ' + dayN + ' 天'
    else if (MILESTONE_NOTE[dayN]) sub = '第 ' + dayN + ' 天 · ' + MILESTONE_NOTE[dayN]
    else if (MILESTONES.indexOf(dayN) >= 0) sub = '第 ' + dayN + ' 天'
    else if (yearN > 0) sub = '第 ' + dayN + ' 天 · ' + yearN + ' 周年'
    else sub = '第 ' + dayN + ' 天'
  }
  return { label: label, sub: sub, dayN: dayN, yearN: yearN, kind: 'event', constellation: constellationOf(dateKey) }
}

/** 区间内所有发生，按日期排序，附带描述 */
export function occurrences(ev, fromKey, toKey) {
  const list = []
  const seen = {}
  const annual = annualDates(ev, fromKey, toKey)
  for (let i = 0; i < annual.length; i++) {
    const d = describe(ev, annual[i])
    seen[annual[i]] = true
    list.push({ date: annual[i], kind: 'annual', ev: ev, label: d.label, sub: d.sub, dayN: d.dayN, yearN: d.yearN })
  }
  const ms = milestoneDates(ev, fromKey, toKey)
  for (let i = 0; i < ms.length; i++) {
    if (seen[ms[i].date]) continue
    /* 整年的节点已经被上面的"周年"覆盖，这里只保留 100 天这类非整年节点，
     * 免得"第 365 天 · 一周年"和周年那天各报一次（差一天时尤其乱）。 */
    const n = ms[i].dayN
    if (ev.repeat !== 'once' && n % 365 === 0 && ev.calendar !== 'lunar') continue
    seen[ms[i].date] = true
    list.push({
      date: ms[i].date, kind: 'milestone', ev: ev, label: ev.title,
      sub: '第 ' + n + ' 天' + (MILESTONE_NOTE[n] ? ' · ' + MILESTONE_NOTE[n] : ''),
      dayN: n, yearN: 0
    })
  }
  list.sort(function (a, b) { return toDayNumber(a.date) - toDayNumber(b.date) })
  return list
}

/** 下一次发生（含里程碑） */
export function nextOccurrence(ev, fromKey, horizonDays) {
  const horizon = horizonDays || 800
  const list = occurrences(ev, fromKey, addDays(fromKey, horizon))
  return list.length ? list[0] : null
}

/** 该事件当天应显示的农历说明（农历生日/纪念日额外信息） */
export function lunarHint(ev, dateKey) {
  if (ev.type === 'birthday' || ev.calendar === 'lunar') {
    const l = solarToLunar(dateKey)
    if (!l) return ''
    return l.text
  }
  return ''
}

export function eventSortKey(ev) {
  const p = parseKey(ev.start)
  return p ? p.m * 100 + p.d : 0
}
