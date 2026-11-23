import { update } from './store.js'
import { nowLocal } from './lunar.js'

const FINALS = [
  { title: '数据库系统概论', date: '2026-12-29', time: '16:30', end: '18:30' },
  { title: '数据结构与算法', date: '2026-12-30', time: '14:00', end: '16:00' },
  { title: '习近平新时代中国特色社会主义思想概论', date: '2027-01-04', time: '10:30', end: '12:30' },
  { title: '线性代数（第一层次）', date: '2027-01-05', time: '16:30', end: '18:30' },
  { title: '软件工程与计算 II', date: '2027-01-06', time: '10:30', end: '12:30' },
  { title: '计算系统基础 II', date: '2027-01-09', time: '16:30', end: '18:30' }
]
const CET = { title: '英语六级笔试', date: '2026-12-12', time: '15:00', end: '17:25' }
const CONTEST = { title: '蓝桥杯软件赛报名截止', date: '2026-12-18', time: '14:00' }

export function focusDates() {
  return { finals: FINALS, cet: CET, contest: CONTEST }
}

export function importFocusDates(selection, now = nowLocal()) {
  const entries = FINALS.slice()
  if (selection && selection.cet === true) entries.push(CET)
  if (selection && selection.contest === true) entries.push(CONTEST)
  return update(function (state) {
    const result = { added: 0, existing: 0, past: 0 }
    for (const entry of entries) {
      const id = 'focus-2026-' + entry.date
      // Also recognize a matching exam already entered manually.
      if (state.ddls.some(d => d.id === id || (d.date === entry.date && d.time === entry.time &&
        (d.title === entry.title || d.title === entry.title + '期末考试')))) {
        result.existing++
        continue
      }
      if (entry.date + ' ' + entry.time < now.key + ' ' + now.time) {
        result.past++
        continue
      }
      state.ddls.push({
        id, title: entry.title, date: entry.date, time: entry.time,
        priority: 'high', done: false, doneAt: null,
        note: entry.end ? '考试时间 ' + entry.time + '–' + entry.end + '（北京时间）' : '官网截止时间，先确认南大校内流程。',
        createdAt: new Date().toISOString()
      })
      result.added++
    }
    return result
  })
}
