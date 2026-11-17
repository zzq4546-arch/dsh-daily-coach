/* dsh-calendar-coach — 公历 / 农历换算与节日
 *
 * 农历数据来自 lib/lunar-table.js（由 tools/gen-lunar-table.ps1 从 Windows/.NET
 * 的 ChineseLunisolarCalendar 导出，即"电脑自带的农历表"）。
 * 不使用 Intl：CLDR 的中国农历在个别年份与官方历法差一天（如 2027 春节）。
 */
import { LUNAR, YEAR_START } from './lunar-table.js'

export const TZ = 'Asia/Shanghai'
const YEAR_END = YEAR_START + LUNAR.length - 1

const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
]
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
})
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
})

/* ---------- 日期键工具（本地时区 = Asia/Shanghai，日期键一律 YYYY-MM-DD） ---------- */

export function pad2(n) { return (n < 10 ? '0' : '') + n }

export function dateKeyOf(dt) {
  // en-CA 的短日期格式即 YYYY-MM-DD
  return keyFmt.format(dt || new Date())
}

export function nowLocal() {
  const dt = new Date()
  return { key: keyFmt.format(dt), time: timeFmt.format(dt), date: dt }
}

export function todayKey() { return dateKeyOf(new Date()) }

export function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y: y, m: mo, d: d }
}

export function isValidKey(key) {
  const p = parseKey(key)
  if (!p) return false
  return keyOf(p.y, p.m, p.d) === key
}

export function keyOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d) }

export function toDayNumber(key) {
  const p = parseKey(key)
  if (!p) return NaN
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000)
}

export function fromDayNumber(n) {
  const dt = new Date(n * 86400000)
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(key, n) { return fromDayNumber(toDayNumber(key) + n) }

export function diffDays(a, b) { return toDayNumber(b) - toDayNumber(a) }

export function dayOfYear(key) {
  const p = parseKey(key)
  return toDayNumber(key) - toDayNumber(keyOf(p.y, 1, 1)) + 1
}

export function weekdayOf(key) {
  const n = toDayNumber(key) + 4 // 1970-01-01 = 周四
  return ((n % 7) + 7) % 7
}

export function daysInMonth(y, m) { return toDayNumber(keyOf(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1)) - toDayNumber(keyOf(y, m, 1)) }

export function monthLabel(key) {
  const p = parseKey(key)
  return p.y + ' 年 ' + p.m + ' 月'
}

export function humanDate(key) {
  const p = parseKey(key)
  if (!p) return String(key || '')
  return p.m + ' 月 ' + p.d + ' 日 ' + WEEKDAY_NAMES[weekdayOf(key)]
}

/* ---------- 农历表访问 ---------- */

function entryOf(ly) {
  if (ly < YEAR_START || ly > YEAR_END) return null
  return LUNAR[ly - YEAR_START]
}

function newYearKey(ly) {
  const e = entryOf(ly)
  if (!e) return null
  return fromDayNumber(toDayNumber(keyOf(ly, 1, 1)) + e[0] - 1)
}

// 农历年 ly 里第 idx 个农历月（0 基）的天数
function monthLen(e, idx) { return e[2 + idx] }

// 农历 (月, 是否闰月) -> 该年内的月序下标（0 基）
function monthIndex(e, month, isLeap) {
  const leap = e[1]
  let idx = month - 1
  if (leap > 0 && (month > leap || (month === leap && isLeap))) idx++
  return idx
}

function monthCount(e) { return e.length - 2 }

// 月序下标 -> [月号, 是否闰月]
function monthOfIndex(e, idx) {
  const leap = e[1]
  if (leap > 0 && idx >= leap) {
    // idx === leap 表示闰 leap 月
    if (idx === leap) return [leap, true]
    return [idx, false]
  }
  return [idx + 1, false]
}

/* ---------- 公历 <-> 农历 ---------- */

export function solarToLunar(key) {
  const p = parseKey(key)
  if (!p) return null
  let ly = p.y
  const ny = newYearKey(p.y)
  if (!ny) return null
  if (toDayNumber(key) < toDayNumber(ny)) ly = p.y - 1
  const e = entryOf(ly)
  if (!e) return null
  const start = newYearKey(ly)
  let offset = toDayNumber(key) - toDayNumber(start)
  let idx = 0
  const total = monthCount(e)
  while (idx < total) {
    const len = monthLen(e, idx)
    if (offset < len) break
    offset -= len
    idx++
  }
  if (idx >= total) return null
  const m = monthOfIndex(e, idx)
  const day = offset + 1
  return {
    year: ly,
    month: m[0],
    day: day,
    isLeap: m[1],
    monthName: (m[1] ? '闰' : '') + MONTH_NAMES[m[0] - 1],
    dayName: DAY_NAMES[day - 1],
    yearGanZhi: ganzhiOf(ly),
    yearZodiac: ZHI[(ly - 4) % 12],
    text: ganzhiOf(ly) + '年' + (m[1] ? '闰' : '') + MONTH_NAMES[m[0] - 1] + DAY_NAMES[day - 1]
  }
}

export function lunarToSolar(year, month, day, isLeap) {
  const e = entryOf(year)
  if (!e || month < 1 || month > 12) return null
  const idx = monthIndex(e, month, !!isLeap)
  if (idx < 0 || idx >= monthCount(e)) return null
  const len = monthLen(e, idx)
  if (day < 1 || day > len) return null
  let off = 0
  for (let i = 0; i < idx; i++) off += monthLen(e, i)
  return fromDayNumber(toDayNumber(newYearKey(year)) + off + day - 1)
}

export function ganzhiOf(ly) {
  return GAN[((ly - 4) % 10 + 10) % 10] + ZHI[((ly - 4) % 12 + 12) % 12]
}

export function zodiacOf(key) {
  const l = solarToLunar(key)
  return l ? l.yearZodiac : ''
}

export function lunarShort(key) {
  const l = solarToLunar(key)
  if (!l) return ''
  if (l.day === 1) return l.monthName
  return l.dayName
}

export function lunarFull(key) {
  const l = solarToLunar(key)
  return l ? l.text : ''
}

/* ---------- 节日 ---------- */

const SOLAR_FESTIVALS = [
  ['01-01', '元旦'],
  ['02-14', '情人节'],
  ['03-08', '妇女节'],
  ['03-12', '植树节'],
  ['04-01', '愚人节'],
  ['05-01', '劳动节'],
  ['05-04', '青年节'],
  ['06-01', '儿童节'],
  ['07-01', '建党节'],
  ['08-01', '建军节'],
  ['09-10', '教师节'],
  ['10-01', '国庆节'],
  ['12-24', '平安夜'],
  ['12-25', '圣诞节'],
  ['11-11', '双十一'],
  ['05-20', '520'],
  ['05-21', '521']
]

const LUNAR_FESTIVALS = [
  [1, 1, '春节'],
  [1, 15, '元宵节'],
  [2, 2, '龙抬头'],
  [5, 5, '端午节'],
  [7, 7, '七夕'],
  [7, 15, '中元节'],
  [8, 15, '中秋节'],
  [9, 9, '重阳节'],
  [12, 8, '腊八节'],
  [12, 23, '小年']
]

// 春节前后，农历表的年份边界只在 1901..2100，越界即返回空
export function festivalsOf(key) {
  const out = []
  const p = parseKey(key)
  if (!p) return out
  const md = pad2(p.m) + '-' + pad2(p.d)
  for (let i = 0; i < SOLAR_FESTIVALS.length; i++) {
    if (SOLAR_FESTIVALS[i][0] === md) out.push(SOLAR_FESTIVALS[i][1])
  }
  const l = solarToLunar(key)
  if (l) {
    for (let i = 0; i < LUNAR_FESTIVALS.length; i++) {
      const f = LUNAR_FESTIVALS[i]
      if (!l.isLeap && f[0] === l.month && f[1] === l.day) out.push(f[2])
    }
    // 除夕：腊月最后一天
    if (l.month === 12 && !l.isLeap) {
      const last = solarToLunar(addDays(key, 1))
      if (last && !(last.month === 12 && last.day === l.day + 1)) out.push('除夕')
    }
  }
  // 母亲节 / 父亲节：5 月、6 月的第二个周日
  const wd = weekdayOf(key)
  if (wd === 0) {
    if (p.m === 5) {
      const second = secondSunday(p.y, 5)
      if (second === p.d) out.push('母亲节')
    }
    if (p.m === 6) {
      const second = secondSunday(p.y, 6)
      if (second === p.d) out.push('父亲节')
    }
  }
  return out
}

function secondSunday(y, m) {
  const first = keyOf(y, m, 1)
  const wd = weekdayOf(first)
  return wd === 0 ? 8 : 15 - wd
}

// 节日的下一次公历日期（用于提醒）——公历节日直接 MM-DD，农历节日按农历年换算
export function nextFestivalKey(name, fromKey) {
  const p = parseKey(fromKey)
  if (!p) return null
  for (let i = 0; i < SOLAR_FESTIVALS.length; i++) {
    if (SOLAR_FESTIVALS[i][1] !== name) continue
    const md = SOLAR_FESTIVALS[i][0].split('-')
    let k = keyOf(p.y, +md[0], +md[1])
    if (toDayNumber(k) < toDayNumber(fromKey)) k = keyOf(p.y + 1, +md[0], +md[1])
    return k
  }
  for (let i = 0; i < LUNAR_FESTIVALS.length; i++) {
    const f = LUNAR_FESTIVALS[i]
    if (f[2] !== name) continue
    for (let y = p.y; y <= p.y + 1; y++) {
      const k = lunarToSolar(y, f[0], f[1], false)
      if (k && toDayNumber(k) >= toDayNumber(fromKey)) return k
    }
    return null
  }
  if (name === '除夕') {
    for (let y = p.y; y <= p.y + 1; y++) {
      const first = lunarToSolar(y, 1, 1, false)
      if (!first) continue
      const eve = addDays(first, -1)
      if (toDayNumber(eve) >= toDayNumber(fromKey)) return eve
    }
  }
  return null
}

/* ---------- 星座 ---------- */

const CONSTELLATIONS = [
  [1, 20, '水瓶座'], [2, 19, '双鱼座'], [3, 21, '白羊座'], [4, 20, '金牛座'],
  [5, 21, '双子座'], [6, 22, '巨蟹座'], [7, 23, '狮子座'], [8, 23, '处女座'],
  [9, 23, '天秤座'], [10, 24, '天蝎座'], [11, 23, '射手座'], [12, 22, '摩羯座']
]

export function constellationOf(key) {
  const p = parseKey(key)
  if (!p) return ''
  let name = '摩羯座'
  for (let i = 0; i < CONSTELLATIONS.length; i++) {
    const c = CONSTELLATIONS[i]
    const start = c[0] * 100 + c[1]
    const mine = p.m * 100 + p.d
    if (mine >= start) name = c[2]
  }
  return name
}
