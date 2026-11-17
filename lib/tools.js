/* dsh-calendar-coach — 给模型用的工具
 * 用户在对话里说"记一下 3 月 14 日是纪念日""100 天的时候提醒我""这周五交简历"，
 * 模型直接调这些工具落库，不需要用户去点界面。
 */
import * as ops from './ops.js'
import { todayText, stateView, lunarView } from './ops.js'
import { humanDate } from './lunar.js'
import { followUp } from './runtime.js'
import { get, update } from './store.js'
import { diag } from './diag.js'

/* 宿主编译工具 schema 时要求每个 object 都显式写 additionalProperties，
 * 否则整个插件挂不上（JsonSchemaError: ... must be explicitly true or false）。
 * 这里统一补全，省得每个工具手写漏掉嵌套层。 */
function strictSchema(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const out = {}
  Object.keys(node).forEach(function (k) { out[k] = node[k] })
  if (out.properties && typeof out.properties === 'object') {
    const props = {}
    Object.keys(out.properties).forEach(function (k) { props[k] = strictSchema(out.properties[k]) })
    out.properties = props
    if (!out.type) out.type = 'object'
  }
  if (out.items) out.items = strictSchema(out.items)
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = true
  return out
}

/* ctx.tools.register() 只校验 output.schema，parameters 会**原样**发给模型 API。
 * 官方 defineTool() 才会把「作者简写」（每个属性上挂 required:true）编译成标准 JSON Schema；
 * 拿不到 defineTool 时若直接透传简写，API 会报：
 *   Invalid schema for function 'calendar_add_ddl': {"type":"string","required":true,...}
 *   is not of type "string"
 * 所以这里补一个手写编译器，把简写转成 { type:'object', properties, required:[...] }。 */
function paramSchema(map) {
  const properties = {}
  const required = []
  Object.keys(map || {}).forEach(function (key) {
    const src = map[key] || {}
    const node = { type: src.type || 'string' }
    if (src.description) node.description = String(src.description)
    if (Array.isArray(src.enum)) node.enum = src.enum.slice()
    if (src.required === true) required.push(key)
    properties[key] = node
  })
  const schema = { type: 'object', properties: properties }
  if (required.length) schema.required = required
  return schema
}

const outSchema = function (props) {
  const properties = { ok: { type: 'boolean' }, text: { type: 'string' } }
  Object.keys(props).forEach(function (k) { properties[k] = props[k] })
  return strictSchema({ type: 'object', additionalProperties: false, properties: properties })
}

/* 宿主的 register() 要求 output 里必须同时有 schema 和 render（见 dsh-tools 的
 * "must declare output { schema, render, presentationMeta? }"）。
 * render 负责把工具结果做成给模型看的内容块，返回 [{ type:'text', text }]。 */
function renderJson(_args, value) {
  let text
  try { text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
  catch (e) { text = String(value) }
  return [{ type: 'text', text: text }]
}

const out = function (_props) {
  /* 值 schema 不逐字段写：宿主的值 schema 校验很挑（属性节点里不允许 required，
   * object 必须显式 additionalProperties），task-board 同样用 type:'json'，
   * 模型照样能读到 JSON 内容。 */
  return { schema: outSchema(_props || {}), render: renderJson }
}

/* 第一次在某个会话里用到日历，就把聊天提醒绑到这个会话，
 * 这样用户不用手动"绑定"，B/C 两路提醒从第一次使用起就能投递过来。 */
let bindSettled = false
function bindSession(ex) {
  if (bindSettled) return Promise.resolve()
  const agent = ex && ex.agent
  const id = agent && agent.session && agent.session.id
  if (!id) return Promise.resolve()
  /* 子 agent 会话（委派深度 > 0）不能当提醒收件人：它跑完就散，
   * 提醒会投进一个没人看的会话。判定方式与 @deepseek-ai/dsh-subagent 的
   * delegationDepthOf 一致：max(session.header.delegationDepth, options.subagentDepth)。 */
  const depth = Math.max(
    (agent.session.header && Number(agent.session.header.delegationDepth)) || 0,
    (agent.options && Number(agent.options.subagentDepth)) || 0
  )
  if (depth > 0) { diag('bindSession 跳过子 agent 会话（depth=' + depth + '）'); return Promise.resolve() }
  const st = get()
  if (st.meta && st.meta.notifySessionId) { bindSettled = true; return Promise.resolve() }
  bindSettled = true
  return update(function (s) { s.meta.notifySessionId = String(id) })
    .then(function () { return followUp('calendar_bind') })
    .catch(function () { /* 绑定失败不影响工具本身 */ })
}

/* 注册结果：宿主里一次性打印，方便定位"工具没出现"这类问题 */
export const report = { ok: [], failed: [] }

export function registerTools(ctx, defineTool) {
  /* 官方 defineTool 能把简写编译成标准 schema；没有它就自己编译 parameters。
   * 两条路径产出的 parameters 都必须是可以直接发给模型 API 的 JSON Schema。 */
  const official = typeof defineTool === 'function' ? defineTool : null
  const def = official || function (spec) {
    return Object.assign({}, spec, { parameters: paramSchema(spec.parameters) })
  }
  diag('defineTool=' + (official ? 'official' : 'missing -> 自己编译 parameters'))
  const hasTools = !!(ctx && ctx.tools && typeof ctx.tools.register === 'function')
  diag('registerTools: hasTools=' + hasTools + ' (typeof ctx.tools=' + typeof (ctx && ctx.tools) + ', typeof register=' + typeof (ctx && ctx.tools && ctx.tools.register) + ')')
  if (!hasTools) report.failed.push({ name: '(ctx.tools)', error: 'ctx.tools 不可用：' + typeof (ctx && ctx.tools) })
  const reg = function (spec) {
    const run = spec.execute
    const wrapped = Object.assign({}, spec, {
      async execute(args, ex) {
        try { await bindSession(ex) } catch (err) { /* ignore */ }
        return run.call(spec, args, ex)
      }
    })
    /* 单个工具注册失败（比如 schema 写法不合宿主口味）不该拖垮整个插件 */
    try {
      if (!hasTools) throw new Error('ctx.tools.register 不存在')
      ctx.tools.register(def(wrapped))
      report.ok.push(spec.name)
      diag('工具注册成功：' + spec.name)
    } catch (err) {
      const detail = { name: spec.name, error: (err && err.message) || String(err), stack: err && err.stack }
      report.failed.push(detail)
      diag('工具注册失败：' + spec.name + ' -> ' + detail.error)
      try { console.error('[dsh-calendar] 工具 ' + spec.name + ' 注册失败：' + detail.error) } catch (e) { /* ignore */ }
    }
  }
  reg({
    name: 'calendar_today',
    description: '查看某一天（默认今天）的日历：公历/农历、节日、当天的纪念日与生日、当天到期和逾期的 DDL、接下来 30 天的提醒。用户在问"今天有什么""最近有什么日子"时用它。',
    parameters: {
      date: { type: 'string', description: '日期 YYYY-MM-DD，不填就是今天' }
    },
    output: out({ date: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } }),
    async execute(args) {
      const date = args && args.date ? String(args.date) : undefined
      const text = todayText(date)
      return { ok: true, text: text, date: date || '', items: [] }
    }
  })

  reg({
    name: 'calendar_list',
    description: '按区间列出日历里的事件和 DDL（默认从今天起 60 天）。用户问"下个月有什么""有哪些纪念日"时用它。',
    parameters: {
      from: { type: 'string', description: '起始日期 YYYY-MM-DD，默认今天' },
      to: { type: 'string', description: '结束日期 YYYY-MM-DD，默认 from + 60 天' },
      keyword: { type: 'string', description: '只看标题里含这个词的' }
    },
    output: out({ events: { type: 'array', items: { type: 'object' } }, ddls: { type: 'array', items: { type: 'object' } } }),
    async execute(args) {
      const a = args || {}
      const view = stateView(a.from, a.to)
      const kw = a.keyword ? String(a.keyword) : ''
      const events = view.events.filter(function (e) { return !kw || e.title.indexOf(kw) >= 0 })
      const ddls = view.ddls.filter(function (d) { return !kw || d.title.indexOf(kw) >= 0 })
      const lines = []
      events.forEach(function (e) {
        const occ = e.occurrences || []
        lines.push('· ' + e.title + (e.calendar === 'lunar' ? '（农历）' : '') + '：' +
          (occ.length ? occ.map(function (o) { return o.date + (o.sub ? ' ' + o.sub : '') }).join('、') : '区间内无发生') +
          '（' + e.id + '）')
      })
      ddls.forEach(function (d) {
        lines.push('□ ' + d.date + ' ' + (d.time || '') + ' ' + d.title + (d.done ? '（已完成）' : '') + '（' + d.id + '）')
      })
      return {
        ok: true,
        text: (lines.length ? lines.join('\n') : '这个区间里没有安排。') + '\n（共 ' + events.length + ' 个日子、' + ddls.length + ' 条 DDL）',
        events: events, ddls: ddls
      }
    }
  })

  reg({
    name: 'calendar_add_event',
    description: '往日历里加一个值得记住的日子：恋爱纪念日、生日、节日、自定义日子。默认每年提醒一次。' +
      '当用户说"记住 X 月 X 日是…""100 天/200 天的时候提醒我"时调用；纪念日默认带里程碑（第 100 天、第 200 天、一周年、520、1314 等）提醒。' +
      '农历生日/农历纪念日把 calendar 设成 lunar。',
    parameters: {
      title: { type: 'string', required: true, description: '这个日子的名字，如「和 TA 在一起」「她的生日」' },
      date: { type: 'string', required: true, description: '基准日期 YYYY-MM-DD；如果是每年一次，写第一次/出生的那一天' },
      type: { type: 'string', enum: ['anniversary', 'birthday', 'festival', 'custom'], description: 'anniversary 纪念日（默认）、birthday 生日、festival 节日、custom 其他' },
      calendar: { type: 'string', enum: ['solar', 'lunar'], description: 'solar 公历（默认）、lunar 农历' },
      repeat: { type: 'string', enum: ['yearly', 'once'], description: 'yearly 每年（默认）、once 只这一次' },
      leadDays: { type: 'string', description: '提前几天提醒，逗号分隔，如 "7,1,0"；默认 7,1,0' },
      remindTime: { type: 'string', description: '当天几点提醒，HH:mm，默认 09:00' },
      milestones: { type: 'boolean', description: '是否提醒第 100/200/520/1314 天这类节点，默认 true' },
      note: { type: 'string', description: '备注' }
    },
    output: out({ event: { type: 'object' } }),
    async execute(args) {
      const ev = await ops.addEvent(args || {})
      const l = lunarView(ev.start)
      const text = '已记下：' + ev.title + '（' + humanDate(ev.start) + (l.lunar ? '，农历 ' + l.lunar.text : '') + '）' +
        (ev.repeat === 'yearly' ? '，每年提醒' : '，只提醒一次') +
        (ev.milestones ? '，含第 100/200/520/1314 天等节点' : '') +
        '\n下一步：' + nextText(ev)
      return { ok: true, text: text, event: ev }
    }
  })

  reg({
    name: 'calendar_add_ddl',
    description: '在某一天加一条待办（DDL）：到期日 + 可选时间 + 要做什么。用户说"这周五交简历""20 号前把报告写完"时调用。',
    parameters: {
      title: { type: 'string', required: true, description: '要做什么' },
      date: { type: 'string', required: true, description: '截止日期 YYYY-MM-DD' },
      time: { type: 'string', description: '具体时间 HH:mm，不填则当天默认 09:00 提醒' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'], description: '重要程度，默认 normal' },
      note: { type: 'string', description: '备注' }
    },
    output: out({ ddl: { type: 'object' } }),
    async execute(args) {
      const d = await ops.addDdl(args || {})
      return { ok: true, text: '已加入 ' + d.date + (d.time ? ' ' + d.time : '') + '：' + d.title + '（' + d.id + '）', ddl: d }
    }
  })

  reg({
    name: 'calendar_update',
    description: '修改已有的事件或 DDL：改日期、改提醒时间、勾选完成、改标题。id 从 calendar_today / calendar_list 的结果里拿。',
    parameters: {
      id: { type: 'string', required: true, description: '事件或 DDL 的 id' },
      title: { type: 'string', description: '新标题' },
      date: { type: 'string', description: '新日期 YYYY-MM-DD' },
      time: { type: 'string', description: 'DDL 的时间 HH:mm' },
      leadDays: { type: 'string', description: '提前几天提醒，如 "7,1,0"' },
      remindTime: { type: 'string', description: '事件提醒时间 HH:mm' },
      done: { type: 'boolean', description: 'DDL 是否已完成' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'], description: '重要程度' },
      note: { type: 'string', description: '备注' }
    },
    output: out({ entity: { type: 'object' } }),
    async execute(args) {
      const a = args || {}
      const id = String(a.id || '')
      try {
        const d = await ops.updateDdl(a)
        return { ok: true, text: '已更新任务：' + d.title + (a.done ? '（已完成）' : ''), entity: d }
      }
      catch (e1) {
        const ev = await ops.updateEvent(a)
        return { ok: true, text: '已更新日子：' + ev.title, entity: ev }
      }
    }
  })

  reg({
    name: 'calendar_delete',
    description: '删掉一个事件或 DDL（id 从 calendar_today / calendar_list 拿）。',
    parameters: { id: { type: 'string', required: true, description: '事件或 DDL 的 id' } },
    output: out({ deleted: { type: 'boolean' } }),
    async execute(args) {
      const id = String((args && args.id) || '')
      try {
        const d = await ops.deleteDdl(id)
        return { ok: true, text: '已删除任务：' + d.title, deleted: true }
      }
      catch (e1) {
        const ev = await ops.deleteEvent(id)
        return { ok: true, text: '已删除日子：' + ev.title, deleted: true }
      }
    }
  })

  reg({
    name: 'calendar_remind',
    description: '把日历提醒绑定到当前这个会话（重要日子和到期 DDL 会主动在这个聊天里发消息）。on=false 关闭聊天提醒。' +
      '用户说"以后提醒我""在这里提醒我"时调用。',
    parameters: { on: { type: 'boolean', description: 'true 打开（默认），false 关闭' } },
    output: out({ bound: { type: 'boolean' }, sessionId: { type: 'string' } }),
    async execute(args, exec) {
      const on = !args || args.on !== false
      const session = exec && exec.agent && exec.agent.session ? exec.agent.session.id : null
      if (!session) return { ok: false, text: '拿不到当前会话 id，无法绑定。', bound: false, sessionId: '' }
      if (!on) {
        await ops.setNotify(false)
        return { ok: true, text: '已关闭这个会话的日历提醒。', bound: false, sessionId: session }
      }
      await ops.setNotify(true)
      await ops.bindSession(session)
      const r = await followUp('calendar_bind')
      return { ok: true, text: '已把日历提醒绑定到当前会话：节日、纪念日、第 100/200 天、到期 DDL 会在这里发消息提醒你。' + (r && r.note ? r.note : ''), bound: true, sessionId: session }
    }
  })
  return report
}

function nextText(ev) {
  const view = stateView()
  const found = (view.events || []).find(function (e) { return e.id === ev.id })
  if (!found || !found.next) return '（暂时没有下一次）'
  const n = found.next
  return '下一次是 ' + n.date + (n.sub ? '（' + n.sub + '）' : '') + (found.daysUntilNext >= 0 ? '，还有 ' + found.daysUntilNext + ' 天' : '')
}
