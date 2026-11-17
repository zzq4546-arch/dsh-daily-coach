/* dsh-calendar-coach — 数据存储
 * 单一 JSON：<DSH_HOME>/calendar/calendar.json（默认 D:\DSH\home\calendar\calendar.json）
 * 写盘 = 临时文件 + rename 原子替换；进程内串行化，避免并发写坏。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/* DSH home 解析：环境变量优先；其次从 profile 目录反推（.../home/profiles/<p> → .../home），
 * 避免宿主没把 DSH_HOME 传给插件时数据跑到 ~/.dsh 里去。 */
function resolveHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const profile = process.env.DSH_PROFILE_DIR
  if (profile) {
    const up1 = path.dirname(profile)            // .../home/profiles
    if (path.basename(up1) === 'profiles') return path.dirname(up1)
  }
  return path.join(os.homedir(), '.dsh')
}

const HOME = resolveHome()
const DIR = path.join(HOME, 'calendar')
const FILE = path.join(DIR, 'calendar.json')
const BAK = path.join(DIR, 'calendar.json.bak')

export const paths = { home: HOME, dir: DIR, file: FILE }

let state = null
let chain = Promise.resolve()

export function newId(prefix) {
  return (prefix || 'it') + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex')
}

function nowIso() { return new Date().toISOString() }

function emptyState() {
  return {
    version: 1,
    rev: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    meta: {
      mode: 'card',
      sound: true,
      notify: true,
      notifySessionId: null,
      digest: { on: true, time: '08:00' },
      digestRecord: null,
      leadDays: [7, 1, 0],
      remindTime: '09:00',
      importantLeadDays: [1, 0]
    },
    events: [],
    ddls: [],
    fired: {},
    scheduled: {}
  }
}

function num(v, def) { return typeof v === 'number' && isFinite(v) ? v : def }

function normEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title || '').trim()
  if (!title) return null
  const start = String(raw.start || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null
  const ev = {
    id: String(raw.id || newId('ev')),
    title: title,
    type: ['anniversary', 'birthday', 'festival', 'custom'].includes(raw.type) ? raw.type : 'anniversary',
    calendar: raw.calendar === 'lunar' ? 'lunar' : 'solar',
    start: start,
    repeat: raw.repeat === 'once' ? 'once' : 'yearly',
    leadDays: Array.isArray(raw.leadDays) ? raw.leadDays.filter(function (d) { return typeof d === 'number' && d >= 0 && d <= 365 }).slice(0, 5) : null,
    remindTime: /^\d{2}:\d{2}$/.test(raw.remindTime || '') ? raw.remindTime : null,
    milestones: raw.milestones !== false,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    tag: typeof raw.tag === 'string' ? raw.tag.slice(0, 40) : '',
    createdAt: raw.createdAt || nowIso()
  }
  if (raw.calendar === 'lunar') {
    const l = raw.lunar && typeof raw.lunar === 'object' ? raw.lunar : null
    ev.lunar = l ? {
      month: num(l.month, 1),
      day: num(l.day, 1),
      isLeap: !!l.isLeap
    } : null
  }
  if (!ev.leadDays || !ev.leadDays.length) ev.leadDays = null
  return ev
}

function normDdl(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title || '').trim()
  if (!title) return null
  const date = String(raw.date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return {
    id: String(raw.id || newId('dl')),
    date: date,
    time: /^\d{2}:\d{2}$/.test(raw.time || '') ? raw.time : null,
    title: title,
    done: !!raw.done,
    doneAt: raw.doneAt || null,
    priority: ['low', 'normal', 'high'].includes(raw.priority) ? raw.priority : 'normal',
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    createdAt: raw.createdAt || nowIso()
  }
}

function normalize(raw) {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const m = raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  base.meta.mode = m.mode === 'page' ? 'page' : 'card'
  base.meta.sound = m.sound !== false
  base.meta.notify = m.notify !== false
  base.meta.notifySessionId = typeof m.notifySessionId === 'string' ? m.notifySessionId : null
  if (m.digest && typeof m.digest === 'object') {
    base.meta.digest = { on: m.digest.on !== false, time: /^\d{2}:\d{2}$/.test(m.digest.time || '') ? m.digest.time : '08:00' }
  }
  base.meta.digestRecord = m.digestRecord && typeof m.digestRecord === 'object' ? m.digestRecord : null
  base.meta.leadDays = Array.isArray(m.leadDays) && m.leadDays.length ? m.leadDays : [7, 1, 0]
  base.meta.remindTime = /^\d{2}:\d{2}$/.test(m.remindTime || '') ? m.remindTime : '09:00'
  base.meta.importantLeadDays = Array.isArray(m.importantLeadDays) && m.importantLeadDays.length ? m.importantLeadDays : [1, 0]
  base.events = (Array.isArray(raw.events) ? raw.events : []).map(normEvent).filter(Boolean)
  base.ddls = (Array.isArray(raw.ddls) ? raw.ddls : []).map(normDdl).filter(Boolean)
  base.fired = raw.fired && typeof raw.fired === 'object' ? raw.fired : {}
  base.scheduled = raw.scheduled && typeof raw.scheduled === 'object' ? raw.scheduled : {}
  base.rev = num(raw.rev, 0)
  base.createdAt = raw.createdAt || base.createdAt
  base.updatedAt = raw.updatedAt || base.updatedAt
  return base
}

export function load() {
  if (state) return state
  try {
    fs.mkdirSync(DIR, { recursive: true })
    if (fs.existsSync(FILE)) {
      const txt = fs.readFileSync(FILE, 'utf8')
      state = normalize(JSON.parse(txt))
    }
    else {
      state = emptyState()
      // 首次运行时就把文件落出来，方便用户直接看到/备份
      try { writeAtomic(state) } catch (e) { /* ignore */ }
    }
  }
  catch (err) {
    // 坏文件不覆盖：先备份，再从空状态起步
    try { if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.corrupt-' + Date.now()) } catch (e) { /* ignore */ }
    console.warn('[dsh-calendar] 读取失败，已从空数据开始：' + (err && err.message))
    state = emptyState()
  }
  return state
}

export function get() { return load() }

function writeAtomic(obj) {
  fs.mkdirSync(DIR, { recursive: true })
  const tmp = FILE + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  try { if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK) } catch (e) { /* ignore */ }
  fs.renameSync(tmp, FILE)
}

/** 串行地修改并落盘。fn(draft, state) 里直接改 draft。 */
export function update(fn) {
  const run = function () {
    const draft = JSON.parse(JSON.stringify(load()))
    const result = fn(draft)
    draft.rev = num(draft.rev, 0) + 1
    draft.updatedAt = nowIso()
    writeAtomic(draft)
    state = draft
    return result === undefined ? draft : result
  }
  // 上一次写入失败也要接着跑，不能堵住队列
  chain = chain.then(run, run)
  return chain
}

export function reset(fresh) {
  chain = chain.then(function () {
    const draft = fresh ? emptyState() : load()
    writeAtomic(draft)
    state = draft
    return draft
  })
  return chain
}

export function stats() {
  const s = load()
  return { file: FILE, rev: s.rev, events: s.events.length, ddls: s.ddls.length, updatedAt: s.updatedAt }
}
