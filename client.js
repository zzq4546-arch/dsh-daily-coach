/* dsh-daily-coach — client half.
 *
 * A fixed panel in the top-right corner of the DSH Web GUI with four tabs:
 *   今日  four daily habits, this week's milestone list, streak, nag line, and
 *         the AI-approval flow that turns "all four done" into attendance;
 *   复盘  one review per day, auto-saved;
 *   笔记  free-form notes;
 *   计划  the active plan as JSON: edit, import, export, reset.
 *
 * Pure DOM, no dependencies, no host-side logic. Everything lives in
 * localStorage:
 *   dsh-daily-coach.v2        打卡 / 复盘 / 笔记 / 面板位置
 *   dsh-daily-coach.plan.v1   当前生效的计划
 * The v0.1 key (dsh-daily-coach.v1) is read once for migration and then left
 * alone as a free backup.
 */
window.__ModuleLoader__.load({
  id: 'dsh-daily-coach',
  factory(require) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* 1. Default plan                                                     */
    /* ------------------------------------------------------------------ */

    /* 2026-11-09, a Monday. */
    var DEFAULT_PLAN = {
      v: 1,
      id: 'default-9w',
      name: '9 周后端实习冲刺',
      start: '2026-11-09',
      daily: [
        { label: '项目 60 分钟', hint: '推进本周清单里的第一件事' },
        { label: 'LeetCode 30 分钟', hint: '1 道题；不会就看题解，再默写一遍' },
        { label: '英语 / 八股 30 分钟', hint: '六级，或 Java / MySQL 面试题' },
        { label: '5 分钟复盘', hint: '去「复盘」页写一句：今天学到了什么' }
      ],
      weeks: [
        {
          id: 'w1', phase: '打底',
          goal: '让法律标注系统能演示、能讲清',
          items: [
            '给法律标注系统补 README：架构图 + 运行方式 + 9 个模块',
            '录 3 分钟演示视频，放到仓库首页',
            'GitHub 置顶 NaiWa，两个仓库补技术点小节',
            '画出 3 条核心数据流：索引对齐 / SVG 拖拽 / 导入校验'
          ]
        },
        {
          id: 'w2', phase: '打底',
          goal: '用 5 个技术点撑起简历，并投进一个实验室',
          items: [
            '写 3 篇技术笔记（差异算法 / SVG 排版 / 导入校验）',
            '准备 5 个面试可讲的点，每个 2 分钟能讲完',
            '简历 v1.2 投 2–3 个实验室（邮件 + 一页纸）',
            '每天 1 道 LeetCode，保持手感'
          ]
        },
        {
          id: 'w3', phase: '起步',
          goal: '跑通第一个能访问的后端接口',
          items: [
            '装 JDK 17 + Maven，跑通 Spring Boot Hello World',
            '设计 5 张表（用户 / 任务 / 标注 / 标签 / 关系）并写建表 SQL',
            '用 MyBatis 连通 MySQL，查出第一条数据',
            '新项目推到 GitHub，README 写清怎么跑'
          ]
        },
        {
          id: 'w4', phase: '起步',
          goal: '写出 3 个能自测的 REST 接口',
          items: [
            '完成登录 / 注册（密码加密 + token）',
            '完成 3 个 CRUD 接口（任务 / 标注 / 标签）',
            'Postman 自测：正常流程 + 异常流程各 1 次',
            '写接口文档：路径 / 参数 / 返回示例'
          ]
        },
        {
          id: 'w5', phase: '冲刺',
          goal: '上线一个别人点得开的链接',
          items: [
            '部署到云服务器（或 Railway / Zeabur），留公网地址',
            '简历 v2.0：后端项目放第一位，补技能',
            '录 1 分钟项目演示，README 放 GIF',
            '投 5 家日常实习试水，记录反馈'
          ]
        },
        {
          id: 'w6', phase: '冲刺',
          goal: '投满 10–20 家，拿到第一个面试',
          items: [
            '整理 10 个高频八股：Java 集合 / 线程、MySQL 索引 / 事务、HTTP',
            '投 10–20 家（BOSS / 实习僧 / 牛客），做投递表',
            '模拟面试 1 次（找同学或 AI 对练）',
            '准备 3 个「项目难点」故事'
          ]
        },
        {
          id: 'w7', phase: '复盘',
          goal: '把被问住的问题全部补上',
          items: [
            '复盘每场面试：记下 3 个答不上的问题',
            '补 3 个薄弱点（写代码验证，不只看八股）',
            '再投 10 家，保持节奏',
            'LeetCode 保持每天 1 题'
          ]
        },
        {
          id: 'w8', phase: '期末',
          goal: '不挂科，项目不断档',
          items: [
            '复习 3 门课重点：数据结构 / 数据库 / 软工',
            '项目降为 30 分钟 / 天，只修 bug 不加功能',
            '整理 9 周产出，更新简历',
            '确认寒假安排（实验室 or 短期实习）'
          ]
        },
        {
          id: 'w9', phase: '考试周',
          goal: '考完，别挂科',
          items: [
            '按考试表复习，先保学分高的课',
            '项目暂停，只保留每天 1 题',
            '考完当天更新简历与 GitHub',
            '订寒假计划（实验室 / 实习）'
          ]
        }
      ],
      after: {
        id: 'after',
        phase: '寒假 · 自由冲刺',
        range: '01.11–02.22',
        goal: '实验室 / 实习 + 项目迭代，别断线',
        items: [
          '实验室：每周至少进组 2 次，争取可署名的产出',
          '实习：投 10 家日常实习，拿下 1 个 offer',
          '项目：给后端项目加 1 个真实功能（评论 / 搜索）',
          '保持：每天 1 题 + 30 分钟英语'
        ]
      }
    };

    /* ------------------------------------------------------------------ */
    /* 2. Constants                                                        */
    /* ------------------------------------------------------------------ */

    var WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    var STATE_KEY = 'dsh-daily-coach.v2';
    var LEGACY_STATE_KEY = 'dsh-daily-coach.v1';
    var PLAN_KEY = 'dsh-daily-coach.plan.v1';
    var STATE_VERSION = 2;
    var STYLE_ID = 'dsh-daily-coach-style';
    var ROOT_ID = 'dsh-daily-coach';
    var PILL_ID = 'dsh-daily-coach-pill';
    var TAB_KEYS = ['today', 'review', 'notes', 'plan'];
    var PLAN_MAX_BYTES = 200000;

    /* ------------------------------------------------------------------ */
    /* 3. Small helpers                                                    */
    /* ------------------------------------------------------------------ */

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function clone(value) { return JSON.parse(JSON.stringify(value)); }

    function trimStr(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }

    function textOf(value) { return String(value == null ? '' : value).replace(/\r\n/g, '\n'); }

    function charCount(value) { return trimStr(value).length; }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    }

    function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

    function fmtDateLong(d) {
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[(d.getDay() + 6) % 7];
    }

    function fmtMD(d) { return (d.getMonth() + 1) + '.' + pad2(d.getDate()); }

    function fmtTs(ms) {
      var d = new Date(ms);
      return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + hhmm(d);
    }

    function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    function dayOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

    function shift(d, n) { var x = dayOnly(d); x.setDate(x.getDate() + n); return x; }

    function diff(a, b) { return Math.round((dayOnly(b) - dayOnly(a)) / 86400000); }

    function parseDateKey(value) {
      if (typeof value !== 'string') return null;
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (!m) return null;
      var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
      var d = new Date(y, mo - 1, da);
      if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
      return d;
    }

    function todayKey() { return keyOf(new Date()); }

    function isNoteShape(n) {
      return !!(n && typeof n.id === 'string' && typeof n.t === 'string' && typeof n.b === 'string');
    }

    /* Small non-cryptographic hash: binds a code to one date + one proof text. */
    function fnv1a(text) {
      var h = 2166136261 >>> 0;
      for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    }

    function normProof(value) {
      return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function expectedCode(key, proof) {
      var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var h = fnv1a(key + '|' + normProof(proof) + '|dsh-daily-coach');
      var out = '';
      for (var i = 0; i < 6; i++) { out += alphabet[h & 31]; h = h >>> 5; }
      return out;
    }

    /* ------------------------------------------------------------------ */
    /* 4. Plan normalisation                                               */
    /* ------------------------------------------------------------------ */

    function itemOf(raw) {
      if (typeof raw === 'string') return { label: trimStr(raw), hint: '' };
      if (raw && typeof raw === 'object') {
        return {
          label: trimStr(raw.label != null ? raw.label : raw.text),
          hint: trimStr(raw.hint)
        };
      }
      return { label: '', hint: '' };
    }

    function weekItemsOf(raw) {
      var out = [];
      if (!Array.isArray(raw)) return out;
      for (var i = 0; i < raw.length; i++) {
        var item = itemOf(raw[i]);
        if (item.label) out.push(item.label);
        if (out.length >= 20) break;
      }
      return out;
    }

    function slugOf(value) {
      var s = String(value == null ? '' : value).trim().toLowerCase();
      return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(s) ? s : '';
    }

    function normalizePlan(input) {
      var errors = [];
      var src = input;

      if (typeof src === 'string') {
        try { src = JSON.parse(src); }
        catch (err) { return { ok: false, errors: ['JSON 解析失败：' + err.message] }; }
      }
      if (!src || typeof src !== 'object' || Array.isArray(src)) {
        return { ok: false, errors: ['计划必须是一个 JSON 对象'] };
      }
      if (src.plan && typeof src.plan === 'object') src = src.plan;

      var size = 0;
      try { size = JSON.stringify(src).length; } catch (err) { size = 0; }
      if (size > PLAN_MAX_BYTES) errors.push('计划太大（超过 ' + Math.round(PLAN_MAX_BYTES / 1000) + ' KB）');

      var name = trimStr(src.name) || '未命名计划';
      if (name.length > 40) errors.push('name 太长（最多 40 字）');

      var startDate = parseDateKey(src.start);
      if (!startDate && Array.isArray(src.start) && src.start.length === 3) {
        var y = parseInt(src.start[0], 10), mo = parseInt(src.start[1], 10), da = parseInt(src.start[2], 10);
        if (mo >= 1 && mo <= 12) {
          var probe = new Date(y, mo - 1, da);
          if (probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === da) startDate = probe;
        }
      }
      if (!startDate) errors.push('start 必须是 YYYY-MM-DD（或 [年, 月(1-12), 日]），例如 "2026-11-09"');

      var dailySrc = src.daily == null ? DEFAULT_PLAN.daily : src.daily;
      var daily = [];
      if (!Array.isArray(dailySrc)) errors.push('daily 必须是数组');
      else if (dailySrc.length < 1 || dailySrc.length > 12) errors.push('daily 要有 1–12 项');
      else {
        for (var i = 0; i < dailySrc.length; i++) {
          var item = itemOf(dailySrc[i]);
          if (!item.label) { errors.push('daily 第 ' + (i + 1) + ' 项没有 label'); continue; }
          if (item.label.length > 60) errors.push('daily 第 ' + (i + 1) + ' 项 label 太长（最多 60 字）');
          daily.push({ label: item.label, hint: item.hint.slice(0, 80) });
        }
      }

      var weeksSrc = src.weeks;
      var weeks = [];
      if (!Array.isArray(weeksSrc)) errors.push('weeks 必须是数组');
      else if (weeksSrc.length < 1 || weeksSrc.length > 52) errors.push('weeks 要有 1–52 周');
      else {
        for (var w = 0; w < weeksSrc.length; w++) {
          var raw = weeksSrc[w];
          if (!raw || typeof raw !== 'object') { errors.push('weeks 第 ' + (w + 1) + ' 项不是对象'); continue; }
          var goal = trimStr(raw.goal);
          if (goal.length > 200) errors.push('weeks 第 ' + (w + 1) + ' 周 goal 太长（最多 200 字）');
          var phase = trimStr(raw.phase).slice(0, 20);
          var items = weekItemsOf(raw.items);
          if (!items.length && goal) { /* 允许只有目标的一周 */ }
          var id = slugOf(raw.id) || 'w' + (w + 1);
          weeks.push({ id: id, phase: phase, goal: goal, items: items });
        }
      }

      var after = null;
      if (src.after && typeof src.after === 'object') {
        after = {
          id: 'after',
          phase: trimStr(src.after.phase).slice(0, 20) || '计划之后',
          range: trimStr(src.after.range).slice(0, 20),
          goal: trimStr(src.after.goal).slice(0, 200),
          items: weekItemsOf(src.after.items)
        };
      }

      var id = slugOf(src.id);
      if (!id) id = 'p' + fnv1a(JSON.stringify([name, keyOf(startDate || new Date()), weeks.length])).toString(36);

      if (errors.length) return { ok: false, errors: errors };

      return {
        ok: true,
        plan: {
          v: 1,
          id: id,
          name: name,
          start: keyOf(startDate),
          daily: daily,
          weeks: weeks,
          after: after,
          updatedAt: Date.now()
        }
      };
    }

    /* ------------------------------------------------------------------ */
    /* 5. Plan + state storage                                             */
    /* ------------------------------------------------------------------ */

    var plan = loadPlan();

    function loadPlan() {
      var stored = null;
      try {
        var raw = window.localStorage.getItem(PLAN_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (err) { stored = null; }
      if (stored) {
        var res = normalizePlan(stored);
        if (res.ok) return res.plan;
      }
      return clone(DEFAULT_PLAN);
    }

    function savePlan(next) {
      plan = next;
      try {
        window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
        return true;
      } catch (err) {
        showAlert('计划保存失败：浏览器存储可能已满。');
        return false;
      }
    }

    /* Set by loadState() when the v0.1 key supplied the data. */
    var migratedFromV1 = false;
    var state = loadState();

    function blankState() {
      return {
        v: STATE_VERSION,
        days: {},
        weeks: {},
        reviews: {},
        notes: [],
        collapsed: false,
        pos: null,
        auditOpen: false,
        tab: 'today',
        reviewDate: todayKey(),
        editingNote: null
      };
    }

    function adoptState(out, parsed) {
      var s = parsed;
      out.days = (s.days && typeof s.days === 'object') ? s.days : {};
      out.weeks = {};
      var wk = (s.weeks && typeof s.weeks === 'object') ? s.weeks : {};
      for (var k in wk) {
        if (!Object.prototype.hasOwnProperty.call(wk, k)) continue;
        if (!Array.isArray(wk[k])) continue;
        out.weeks[k.indexOf(':') === -1 ? plan.id + ':' + k : k] = wk[k].slice(0);
      }
      out.reviews = (s.reviews && typeof s.reviews === 'object') ? s.reviews : {};
      out.notes = Array.isArray(s.notes) ? s.notes.filter(isNoteShape) : [];
      out.collapsed = !!s.collapsed;
      out.pos = (s.pos && typeof s.pos.left === 'number' && typeof s.pos.top === 'number')
        ? { left: s.pos.left, top: s.pos.top } : null;
      out.auditOpen = !!s.auditOpen;
      out.tab = TAB_KEYS.indexOf(s.tab) >= 0 ? s.tab : 'today';
      out.reviewDate = parseDateKey(s.reviewDate) ? s.reviewDate : out.reviewDate;
      out.editingNote = null;
      return out;
    }

    function loadState() {
      var out = blankState();
      try {
        var raw = window.localStorage.getItem(STATE_KEY);
        if (!raw) {
          raw = window.localStorage.getItem(LEGACY_STATE_KEY);
          if (raw) migratedFromV1 = true;
        }
        if (!raw) return out;
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return adoptState(out, parsed);
      } catch (err) { /* broken storage: start clean */ }
      return out;
    }

    function saveState() {
      try {
        window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
        return true;
      } catch (err) {
        showAlert('保存失败：浏览器存储可能已满。先到「计划 → 下载备份」存一份，再清理一些笔记。');
        return false;
      }
    }

    /* ------------------------------------------------------------------ */
    /* 6. Records                                                          */
    /* ------------------------------------------------------------------ */

    function blankFlags() {
      var list = [];
      for (var i = 0; i < plan.daily.length; i++) list.push(false);
      return list;
    }

    function flagsFor(map, id, count) {
      var list = map[id];
      if (!Array.isArray(list) || list.length !== count) {
        var next = [];
        for (var i = 0; i < count; i++) next.push(!!(list && list[i]));
        map[id] = next;
        return next;
      }
      return list;
    }

    /* A day is { f: [flags], a: approved, p: proof, c: code, at: ts }.
       Days written by v0.1 were plain arrays: keep them approved when full. */
    function recordFor(key) {
      var raw = state.days[key];
      if (Array.isArray(raw)) {
        var flags = [];
        for (var i = 0; i < plan.daily.length; i++) flags.push(!!raw[i]);
        var migrated = { f: flags, a: key < todayKey(), p: '', c: '' };
        state.days[key] = migrated;
        return migrated;
      }
      if (raw && Array.isArray(raw.f)) {
        var padded = [];
        for (var j = 0; j < plan.daily.length; j++) padded.push(!!raw.f[j]);
        raw.f = padded;
        if (typeof raw.a !== 'boolean') raw.a = false;
        return raw;
      }
      var fresh = { f: blankFlags(), a: false, p: '', c: '' };
      state.days[key] = fresh;
      return fresh;
    }

    function dayFlags(key) { return recordFor(key).f; }

    function weekMapKey(week) { return plan.id + ':' + week.id; }

    function weekFlags(week) {
      if (!week || !week.items || !week.items.length) return [];
      return flagsFor(state.weeks, weekMapKey(week), week.items.length);
    }

    function doneCount(list) {
      var n = 0;
      for (var i = 0; i < list.length; i++) if (list[i]) n++;
      return n;
    }

    function isFull(list) { return list.length > 0 && doneCount(list) === list.length; }

    /* Reviews: { 'YYYY-MM-DD': { t: text, u: updatedAt } } */
    function reviewForKey(key) {
      var rec = state.reviews[key];
      return (rec && typeof rec.t === 'string') ? rec : null;
    }

    /* An empty review is removed again, so the history stays honest. */
    function saveReview(key, text) {
      if (!key) return;
      var body = String(text == null ? '' : text);
      if (!body.trim()) {
        if (state.reviews[key]) { delete state.reviews[key]; saveState(); }
        return;
      }
      var prev = state.reviews[key];
      if (prev && prev.t === body) return;
      state.reviews[key] = { t: body, u: Date.now() };
      saveState();
    }

    /* Read-only: never creates a record for a day that has none. */
    function approvedAt(key) {
      var raw = state.days[key];
      if (Array.isArray(raw)) {
        var flags = [];
        for (var i = 0; i < plan.daily.length; i++) flags.push(!!raw[i]);
        return key < todayKey() && isFull(flags);
      }
      return !!(raw && raw.a && Array.isArray(raw.f) && isFull(raw.f));
    }

    function streak(today) {
      var n = 0;
      var d = today;
      if (!approvedAt(keyOf(d))) d = shift(d, -1);
      while (n < 365) {
        if (!approvedAt(keyOf(d))) break;
        n++;
        d = shift(d, -1);
      }
      return n;
    }

    /* ------------------------------------------------------------------ */
    /* 7. Week lookup                                                      */
    /* ------------------------------------------------------------------ */

    function planStartDate() {
      return parseDateKey(plan.start) || new Date();
    }

    function weekRange(startDate, index) {
      var a = shift(startDate, index * 7);
      var b = shift(a, 6);
      return fmtMD(a) + '–' + fmtMD(b);
    }

    function weekFor(today) {
      var startDate = planStartDate();
      var index = Math.floor(diff(startDate, today) / 7);
      if (index < 0) index = 0;
      if (index < plan.weeks.length) {
        var week = plan.weeks[index];
        return {
          index: index,
          total: plan.weeks.length,
          id: week.id,
          phase: week.phase,
          goal: week.goal,
          items: week.items || [],
          range: week.range || weekRange(startDate, index),
          label: '第 ' + (index + 1) + '/' + plan.weeks.length + ' 周'
        };
      }
      var tail = plan.after;
      if (tail) {
        return {
          index: plan.weeks.length,
          total: plan.weeks.length,
          id: tail.id || 'after',
          phase: tail.phase || '',
          goal: tail.goal || '',
          items: tail.items || [],
          range: tail.range || '',
          label: '计划之后'
        };
      }
      return {
        index: plan.weeks.length,
        total: plan.weeks.length,
        id: 'after',
        phase: '',
        goal: '',
        items: [],
        range: '',
        label: '计划已结束'
      };
    }

    function beforeStart(today) {
      var startDate = planStartDate();
      return keyOf(today) < keyOf(startDate);
    }

    /* ------------------------------------------------------------------ */
    /* 8. Nag line                                                         */
    /* ------------------------------------------------------------------ */

    function nagFor(today, done, total, approved) {
      if (beforeStart(today)) {
        var startDate = planStartDate();
        return {
          tone: '',
          text: '计划从 ' + (startDate.getMonth() + 1) + '月' + startDate.getDate() + '日 开始。今天不算考勤，先把本周清单看一遍，早点睡。'
        };
      }
      var h = today.getHours();
      var left = total - done;
      if (done === total) {
        return approved
          ? { tone: 'ok', text: '今天 ' + total + '/' + total + ' 已通过 AI 审批。去休息，明天同一时间再战。' }
          : { tone: 'warn', text: total + ' 项做完了，但还没过审。点「提交审批」→ 复制请求发我，拿到审批码才算今天全勤。' };
      }
      var parts = [];
      var yKey = keyOf(shift(today, -1));
      var yRaw = state.days[yKey];
      var yArr = Array.isArray(yRaw) ? yRaw : (yRaw && yRaw.f);
      var yLeft = yArr ? total - doneCount(yArr) : 0;
      if (yLeft > 0 && h < 12) parts.push('昨天差 ' + yLeft + ' 项。');
      else if (yArr && doneCount(yArr) >= total && !approvedAt(yKey) && h < 12) parts.push('昨天做完了但没过审。');
      if (h < 9) {
        parts.push('早上先做 25 分钟：打开项目，改一行也算开始。');
      } else if (h < 14) {
        parts.push(done === 0
          ? '现在开始：项目 60 分钟，先把本周第一件事推进一格。'
          : '还有 ' + left + ' 项没做，别让下午空转。');
      } else if (h < 18) {
        parts.push(done === 0
          ? '下午了还是 0 项。先做 1 道 LeetCode 热身，再开项目。'
          : '还剩 ' + left + ' 项，晚饭前再收一项。');
      } else if (h < 21) {
        parts.push('还有 ' + left + ' 项没做。今晚 9 点前收尾，别拖到睡前。');
      } else if (h < 23) {
        parts.push('只剩 ' + left + ' 项。现在去做，别等 12 点。');
      } else {
        parts.push('今天没全勤。明天补上，别连断两天。');
      }
      if (today.getDay() === 0) parts.push('周日了，去「复盘」页把这一周写完，然后告诉我，我帮你总结。');
      var tone = '';
      if (done < total) {
        if (h >= 21) tone = 'danger';
        else if (h >= 18) tone = 'warn';
      }
      return { tone: tone, text: parts.join(' ') };
    }

    /* ------------------------------------------------------------------ */
    /* 9. Styles                                                           */
    /* ------------------------------------------------------------------ */

    var CSS = [
      '#' + ROOT_ID + '{position:fixed;top:64px;right:16px;width:336px;max-width:calc(100vw - 24px);z-index:2147482000;',
      'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#e8ecf4;color-scheme:dark;',
      'background:linear-gradient(165deg,rgba(24,28,38,.97),rgba(16,19,26,.97));border:1px solid rgba(255,255,255,.09);',
      'border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.2);',
      '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);user-select:none;overflow:hidden}',
      '#' + ROOT_ID + '.ddc-pulse{animation:ddc-pulse 1.5s ease-out 2}',
      '@keyframes ddc-pulse{0%{box-shadow:0 0 0 0 rgba(91,140,255,.45),0 18px 48px rgba(0,0,0,.45)}',
      '70%{box-shadow:0 0 0 14px rgba(91,140,255,0),0 18px 48px rgba(0,0,0,.45)}',
      '100%{box-shadow:0 0 0 0 rgba(91,140,255,0),0 18px 48px rgba(0,0,0,.45)}}',
      '.ddc-head{display:flex;align-items:center;gap:8px;padding:12px 14px 6px;cursor:grab;touch-action:none}',
      '.ddc-head:active{cursor:grabbing}',
      '.ddc-dot{width:8px;height:8px;border-radius:50%;background:#3ddc97;box-shadow:0 0 0 3px rgba(61,220,151,.15);flex:none}',
      '.ddc-title{font-size:13.5px;font-weight:600;letter-spacing:.2px}',
      '.ddc-date{margin-left:auto;font-size:11px;color:#93a0b4;font-variant-numeric:tabular-nums}',
      '.ddc-collapse{appearance:none;border:0;background:rgba(255,255,255,.06);color:#c7d0de;width:22px;height:22px;border-radius:7px;',
      'cursor:pointer;font-size:14px;line-height:1;display:grid;place-items:center;flex:none;padding:0}',
      '.ddc-collapse:hover{background:rgba(255,255,255,.13)}',
      '.ddc-tabs{display:flex;gap:4px;padding:2px 12px 8px}',
      '.ddc-tab{appearance:none;border:1px solid transparent;background:rgba(255,255,255,.04);color:#93a0b4;cursor:pointer;flex:1;',
      'font:500 11.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;padding:6px 0;border-radius:8px}',
      '.ddc-tab:hover{background:rgba(255,255,255,.09);color:#cfd8e6}',
      '.ddc-tab.is-active{background:rgba(91,140,255,.18);border-color:rgba(91,140,255,.40);color:#c9d8ff}',
      '.ddc-alert{display:none;margin:0 12px 8px;padding:7px 9px;border-radius:8px;font-size:11px;line-height:1.45;',
      'background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.35);color:#ffb3b3}',
      '.ddc-alert.is-on{display:block}',
      '.ddc-body{padding:0 14px 12px;max-height:calc(100vh - 200px);overflow:auto}',
      '.ddc-body::-webkit-scrollbar{width:6px}',
      '.ddc-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}',
      '.ddc-pane{display:none}',
      '.ddc-pane.is-active{display:block}',
      '.ddc-phase{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#93a0b4;margin-bottom:6px}',
      '.ddc-phase b{color:#7ea6ff;font-weight:600}',
      '.ddc-range{margin-left:auto;font-variant-numeric:tabular-nums;opacity:.8;font-size:11px}',
      '.ddc-goal{font-size:12px;line-height:1.5;color:#dfe6f2;background:rgba(91,140,255,.10);border-left:2px solid #5b8cff;',
      'border-radius:0 7px 7px 0;padding:6px 9px;margin:2px 0 10px;text-wrap:balance}',
      '.ddc-goal b{color:#9db9ff;font-weight:600}',
      '.ddc-label{display:flex;align-items:center;gap:6px;font-size:10.5px;color:#7f8ba0;letter-spacing:1px;margin:10px 0 2px}',
      '.ddc-label::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.06)}',
      '.ddc-item{display:flex;gap:9px;align-items:flex-start;padding:6px 6px 6px 2px;border-radius:8px;cursor:pointer;transition:background .15s ease}',
      '.ddc-item:hover{background:rgba(255,255,255,.045)}',
      '.ddc-item:focus-visible{outline:1px solid rgba(91,140,255,.6);outline-offset:1px}',
      '.ddc-box{flex:none;width:15px;height:15px;border:1.5px solid rgba(255,255,255,.30);border-radius:4.5px;margin-top:1px;',
      'position:relative;transition:background .15s ease,border-color .15s ease}',
      '.ddc-box::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #0b1220;border-width:0 2px 2px 0;',
      'transform:rotate(42deg) scale(.4);opacity:0;transition:all .15s ease}',
      '.ddc-item.is-done .ddc-box{background:#3ddc97;border-color:#3ddc97}',
      '.ddc-item.is-done .ddc-box::after{opacity:1;transform:rotate(42deg) scale(1)}',
      '.ddc-text{min-width:0}',
      '.ddc-text b{display:block;font-size:12.5px;font-weight:500;color:#e8ecf4;transition:color .15s ease}',
      '.ddc-text em{display:block;font-style:normal;font-size:10.5px;color:#7f8ba0;margin-top:1px;line-height:1.4}',
      '.ddc-item.is-done .ddc-text b{color:#7f8ba0;text-decoration:line-through;text-decoration-color:rgba(127,139,160,.6)}',
      '.ddc-week{border-top:1px dashed rgba(255,255,255,.08);margin-top:12px;padding-top:10px}',
      '.ddc-week .ddc-item{padding:4px 6px 4px 2px}',
      '.ddc-week .ddc-text b{font-size:11.5px;font-weight:400;line-height:1.45}',
      '.ddc-week .ddc-box{width:13px;height:13px;border-radius:4px}',
      '.ddc-week .ddc-box::after{left:3.5px;top:1px;width:3.5px;height:7px}',
      '.ddc-meter{display:flex;align-items:center;gap:9px;margin:10px 0 2px}',
      '.ddc-bar{flex:1;height:5px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}',
      '.ddc-bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#5b8cff,#3ddc97);transition:width .35s ease}',
      '.ddc-count{font-size:11px;color:#93a0b4;font-variant-numeric:tabular-nums;min-width:28px;text-align:right}',
      '.ddc-streak{font-size:11px;color:#ffb454;margin-top:6px;display:none}',
      '.ddc-streak.is-on{display:block}',
      '.ddc-audit{border-top:1px dashed rgba(255,255,255,.08);margin-top:10px;padding-top:9px}',
      '.ddc-audit-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:#93a0b4}',
      '.ddc-audit-head .is-wait{color:#ffb454}',
      '.ddc-audit-head .is-ok{color:#3ddc97}',
      '.ddc-mini{appearance:none;font:500 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;padding:5px 8px;',
      'border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#cfd8e6;cursor:pointer;flex:none}',
      '.ddc-mini:hover{background:rgba(255,255,255,.10)}',
      '.ddc-mini:disabled{opacity:.55;cursor:default}',
      '.ddc-mini.is-primary{background:rgba(91,140,255,.20);border-color:rgba(91,140,255,.45);color:#c9d8ff}',
      '.ddc-mini.is-danger{background:rgba(255,107,107,.10);border-color:rgba(255,107,107,.35);color:#ffb3b3}',
      '.ddc-audit-form{display:none;margin-top:8px}',
      '.ddc-audit-form.is-open{display:block}',
      '.ddc-audit textarea{display:block;width:100%;box-sizing:border-box;resize:vertical;min-height:46px;border-radius:8px;',
      'border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.28);color:#e8ecf4;',
      'font:11.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;padding:7px 9px;outline:none}',
      '.ddc-audit textarea:focus{border-color:rgba(91,140,255,.55)}',
      '.ddc-audit textarea.ddc-request{display:none;margin-top:6px;font-size:10.5px;min-height:56px}',
      '.ddc-audit textarea.ddc-request.is-open{display:block}',
      '.ddc-audit-row{display:flex;gap:6px;align-items:center;margin-top:6px}',
      '.ddc-audit input{flex:1;min-width:0;box-sizing:border-box;border-radius:7px;border:1px solid rgba(255,255,255,.10);',
      'background:rgba(0,0,0,.28);color:#e8ecf4;letter-spacing:1px;text-transform:uppercase;padding:6px 8px;outline:none;',
      'font:600 11.5px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
      '.ddc-audit input:focus{border-color:rgba(91,140,255,.55)}',
      '.ddc-audit-msg{margin-top:6px;font-size:10.5px;line-height:1.45;color:#93a0b4;min-height:14px}',
      '.ddc-audit-msg.is-err{color:#ff9d9d}',
      '.ddc-audit-msg.is-ok{color:#9ff0c8}',
      '.ddc-nag{margin-top:12px;padding:8px 10px;border-radius:9px;font-size:11.5px;line-height:1.5;color:#c7d0de;',
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);transition:background .2s ease,border-color .2s ease}',
      '.ddc-nag.is-warn{background:rgba(255,180,84,.09);border-color:rgba(255,180,84,.35);color:#ffcf94}',
      '.ddc-nag.is-danger{background:rgba(255,107,107,.11);border-color:rgba(255,107,107,.40);color:#ffb3b3}',
      '.ddc-nag.is-ok{background:rgba(61,220,151,.10);border-color:rgba(61,220,151,.32);color:#9ff0c8}',
      '.ddc-tool{display:flex;align-items:center;gap:6px;margin:2px 0 6px;font-size:11px;color:#7f8ba0}',
      '.ddc-tool .ddc-sp{margin-left:auto}',
      '.ddc-input{display:block;width:100%;box-sizing:border-box;border-radius:8px;border:1px solid rgba(255,255,255,.10);',
      'background:rgba(0,0,0,.28);color:#e8ecf4;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
      'padding:6px 8px;outline:none;margin-top:6px}',
      '.ddc-input:focus{border-color:rgba(91,140,255,.55)}',
      '.ddc-tool .ddc-input{width:auto;flex:1;margin-top:0}',
      '.ddc-area{display:block;width:100%;box-sizing:border-box;border-radius:9px;border:1px solid rgba(255,255,255,.10);',
      'background:rgba(0,0,0,.28);color:#e8ecf4;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
      'padding:8px 9px;outline:none;resize:vertical;min-height:110px;margin-top:6px}',
      '.ddc-area:focus{border-color:rgba(91,140,255,.55)}',
      '.ddc-area.is-tall{min-height:150px}',
      '.ddc-area.is-code{min-height:190px;font:11px/1.55 Consolas,"Cascadia Mono",Menlo,monospace;white-space:pre;tab-size:2}',
      '.ddc-chips{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 2px}',
      '.ddc-chip{appearance:none;font:500 10.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
      'padding:4px 8px;border-radius:99px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#9fb0c8;cursor:pointer}',
      '.ddc-chip:hover{background:rgba(255,255,255,.10);color:#cfd8e6}',
      '.ddc-list{margin-top:8px;display:flex;flex-direction:column;gap:5px;max-height:230px;overflow:auto}',
      '.ddc-row{border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:6px 8px;background:rgba(255,255,255,.03);cursor:pointer}',
      '.ddc-row:hover{background:rgba(255,255,255,.07)}',
      '.ddc-row.is-on{border-color:rgba(91,140,255,.5);background:rgba(91,140,255,.10)}',
      '.ddc-row .d{font-size:10.5px;color:#7f8ba0;display:flex;gap:6px}',
      '.ddc-row .t{font-size:11.5px;color:#dfe6f2;line-height:1.45;margin-top:2px;white-space:pre-wrap;word-break:break-word;',
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.ddc-empty{font-size:11px;color:#6f7b8d;padding:8px 2px}',
      '.ddc-editor{display:none;margin-top:8px}',
      '.ddc-editor.is-open{display:block}',
      '.ddc-msg-line{margin-top:6px;font-size:10.5px;line-height:1.45;min-height:14px;color:#93a0b4}',
      '.ddc-msg-line.is-err{color:#ff9d9d}',
      '.ddc-msg-line.is-ok{color:#9ff0c8}',
      '.ddc-card{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.03);',
      'font-size:11px;color:#aab6c8;line-height:1.6}',
      '.ddc-card b{color:#dfe6f2}',
      '.ddc-btns{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}',
      '.ddc-rule{height:1px;background:rgba(255,255,255,.07);margin:10px 0}',
      '#' + PILL_ID + '{display:none;position:fixed;top:64px;right:16px;z-index:2147482000;align-items:center;gap:7px;',
      'padding:7px 12px;border-radius:99px;background:rgba(24,28,38,.97);border:1px solid rgba(255,255,255,.10);',
      'box-shadow:0 10px 30px rgba(0,0,0,.4);color:#e8ecf4;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
      'cursor:grab;user-select:none;touch-action:none}',
      '#' + PILL_ID + '.is-on{display:flex}',
      '#' + PILL_ID + ' .ddc-pill-dot{width:7px;height:7px;border-radius:50%;background:#ffb454}',
      '#' + PILL_ID + ' .ddc-pill-dot.is-ok{background:#3ddc97}',
      '@media (prefers-reduced-motion: reduce){#' + ROOT_ID + '{transition:none}.ddc-bar i{transition:none}',
      '#' + ROOT_ID + '.ddc-pulse{animation:none}}'
    ].join('\n');

    /* ------------------------------------------------------------------ */
    /* 10. Template                                                        */
    /* ------------------------------------------------------------------ */

    var TEMPLATE = '' +
      '<div class="ddc-head" title="按住拖动">' +
      '<span class="ddc-dot"></span>' +
      '<span class="ddc-title">今日任务</span>' +
      '<span class="ddc-date" data-ref="date"></span>' +
      '<button class="ddc-collapse" type="button" aria-label="收起面板" data-act="collapse">–</button>' +
      '</div>' +
      '<div class="ddc-tabs" role="tablist">' +
      '<button type="button" class="ddc-tab is-active" role="tab" aria-selected="true" data-tab="today" data-ref="tabToday">今日</button>' +
      '<button type="button" class="ddc-tab" role="tab" aria-selected="false" data-tab="review" data-ref="tabReview">复盘</button>' +
      '<button type="button" class="ddc-tab" role="tab" aria-selected="false" data-tab="notes" data-ref="tabNotes">笔记</button>' +
      '<button type="button" class="ddc-tab" role="tab" aria-selected="false" data-tab="plan" data-ref="tabPlan">计划</button>' +
      '</div>' +
      '<div class="ddc-alert" data-ref="alert"></div>' +
      '<div class="ddc-body">' +

      /* --- today --- */
      '<section class="ddc-pane is-active" data-pane="today" role="tabpanel">' +
      '<div class="ddc-phase"><b data-ref="wk"></b><span data-ref="phase"></span><span class="ddc-range" data-ref="range"></span></div>' +
      '<div class="ddc-goal" data-ref="goal"></div>' +
      '<div class="ddc-label">今天</div>' +
      '<div data-ref="today"></div>' +
      '<div class="ddc-meter"><div class="ddc-bar"><i data-ref="fill"></i></div><span class="ddc-count" data-ref="count"></span></div>' +
      '<div class="ddc-streak" data-ref="streak"></div>' +
      '<div class="ddc-audit">' +
      '<div class="ddc-audit-head"><span data-ref="auditState">考勤：进行中</span>' +
      '<button type="button" class="ddc-mini" data-ref="auditToggle" data-act="audit-toggle">提交审批</button></div>' +
      '<div class="ddc-audit-form" data-ref="auditForm">' +
      '<textarea data-ref="proof" rows="2" placeholder="今天实际做了什么？写一两句，AI 会核对"></textarea>' +
      '<div class="ddc-audit-row"><button type="button" class="ddc-mini" data-act="audit-copy">1. 复制审批请求</button></div>' +
      '<textarea data-ref="requestOut" class="ddc-request" readonly rows="3"></textarea>' +
      '<div class="ddc-audit-row"><input data-ref="code" maxlength="8" placeholder="审批码" aria-label="审批码">' +
      '<button type="button" class="ddc-mini is-primary" data-act="audit-submit">2. 确认</button></div>' +
      '<div class="ddc-audit-msg" data-ref="auditMsg"></div>' +
      '</div></div>' +
      '<div class="ddc-week">' +
      '<div class="ddc-label">本周清单 <span data-ref="weekCount"></span></div>' +
      '<div data-ref="weekList"></div>' +
      '</div>' +
      '<div class="ddc-nag" data-ref="nag"></div>' +
      '</section>' +

      /* --- review --- */
      '<section class="ddc-pane" data-pane="review" role="tabpanel">' +
      '<div class="ddc-tool">' +
      '<button type="button" class="ddc-mini" data-act="rev-prev" aria-label="前一天">◀</button>' +
      '<input class="ddc-input" type="date" data-ref="revDate" aria-label="复盘日期">' +
      '<button type="button" class="ddc-mini" data-act="rev-next" aria-label="后一天">▶</button>' +
      '<button type="button" class="ddc-mini" data-act="rev-today">今天</button>' +
      '</div>' +
      '<div class="ddc-tool"><span data-ref="revLabel">今天的复盘</span><span class="ddc-sp" data-ref="revStat"></span></div>' +
      '<textarea class="ddc-area is-tall" data-ref="revText" placeholder="今天做了什么、卡在哪、明天第一件事是……"></textarea>' +
      '<div class="ddc-chips">' +
      '<button type="button" class="ddc-chip" data-act="rev-tpl-learn">今天学到</button>' +
      '<button type="button" class="ddc-chip" data-act="rev-tpl-stuck">卡住的地方</button>' +
      '<button type="button" class="ddc-chip" data-act="rev-tpl-next">明天第一件事</button>' +
      '</div>' +
      '<div class="ddc-btns">' +
      '<button type="button" class="ddc-mini" data-act="rev-proof">用作审批备注</button>' +
      '<button type="button" class="ddc-mini" data-act="rev-copy">复制全部</button>' +
      '<button type="button" class="ddc-mini" data-act="rev-download">下载 .md</button>' +
      '</div>' +
      '<div class="ddc-msg-line" data-ref="revMsg"></div>' +
      '<div class="ddc-label">最近的复盘</div>' +
      '<div class="ddc-list" data-ref="revList"></div>' +
      '</section>' +

      /* --- notes --- */
      '<section class="ddc-pane" data-pane="notes" role="tabpanel">' +
      '<div class="ddc-tool">' +
      '<button type="button" class="ddc-mini is-primary" data-act="note-new">新建笔记</button>' +
      '<span class="ddc-sp" data-ref="noteStat"></span>' +
      '</div>' +
      '<div class="ddc-editor" data-ref="noteEditor">' +
      '<input class="ddc-input" data-ref="noteTitle" placeholder="标题（可以留空）">' +
      '<textarea class="ddc-area is-tall" data-ref="noteBody" placeholder="随便写：想法、代码片段、面试题、书摘……"></textarea>' +
      '<div class="ddc-btns">' +
      '<button type="button" class="ddc-mini" data-act="note-done">完成</button>' +
      '<button type="button" class="ddc-mini is-danger" data-act="note-del">删除</button>' +
      '<button type="button" class="ddc-mini" data-act="note-copy">复制</button>' +
      '</div>' +
      '<div class="ddc-msg-line" data-ref="noteMsg"></div>' +
      '</div>' +
      '<div class="ddc-list" data-ref="noteList"></div>' +
      '</section>' +

      /* --- plan --- */
      '<section class="ddc-pane" data-pane="plan" role="tabpanel">' +
      '<div class="ddc-card" data-ref="planCard"></div>' +
      '<div class="ddc-btns">' +
      '<button type="button" class="ddc-mini" data-act="plan-edit">编辑计划</button>' +
      '<button type="button" class="ddc-mini" data-act="plan-import">导入计划</button>' +
      '<button type="button" class="ddc-mini" data-act="plan-copy">复制 JSON</button>' +
      '<button type="button" class="ddc-mini" data-act="plan-download">下载 .json</button>' +
      '<button type="button" class="ddc-mini is-danger" data-act="plan-reset">恢复默认</button>' +
      '</div>' +
      '<div class="ddc-editor" data-ref="planEditor">' +
      '<div class="ddc-tool"><span data-ref="planMode">编辑计划</span><span class="ddc-sp" data-ref="planChars"></span></div>' +
      '<textarea class="ddc-area is-code" data-ref="planText" spellcheck="false"></textarea>' +
      '<div class="ddc-btns">' +
      '<button type="button" class="ddc-mini" data-act="plan-file">从文件导入</button>' +
      '<button type="button" class="ddc-mini is-primary" data-act="plan-apply" data-ref="planApply">保存并应用</button>' +
      '<button type="button" class="ddc-mini" data-act="plan-cancel">取消</button>' +
      '</div>' +
      '<div class="ddc-msg-line" data-ref="planEditorMsg"></div>' +
      '<input type="file" accept=".json,application/json" hidden data-ref="planFile">' +
      '</div>' +
      '<div class="ddc-rule"></div>' +
      '<div class="ddc-label">数据</div>' +
      '<div class="ddc-btns">' +
      '<button type="button" class="ddc-mini" data-act="backup-copy">复制备份</button>' +
      '<button type="button" class="ddc-mini" data-act="backup-download">下载备份</button>' +
      '<button type="button" class="ddc-mini" data-act="backup-import">恢复备份</button>' +
      '</div>' +
      '<div class="ddc-msg-line" data-ref="planMsg"></div>' +
      '</section>' +

      '</div>';

    /* ------------------------------------------------------------------ */
    /* 11. DOM handles                                                     */
    /* ------------------------------------------------------------------ */

    var root = null;
    var pill = null;
    var els = {};
    var paneEls = {};
    var drag = null;
    var pillDraggedAt = 0;
    var timer = null;
    var storageHandler = null;
    var renderedKey = '';
    var editorMode = null;
    var revTimer = null;
    var noteTimer = null;
    var alertTimer = null;
    var confirms = {};

    function refs(host) {
      var nodes = host.querySelectorAll('[data-ref]');
      for (var i = 0; i < nodes.length; i++) els[nodes[i].getAttribute('data-ref')] = nodes[i];
      var panes = host.querySelectorAll('[data-pane]');
      for (var j = 0; j < panes.length; j++) paneEls[panes[j].getAttribute('data-pane')] = panes[j];
    }

    function setArea(node, value) {
      if (!node) return;
      if (document.activeElement === node) return;
      if (node.value !== value) node.value = value;
    }

    function setMsg(node, text, kind) {
      if (!node) return;
      node.textContent = text || '';
      node.className = (node.getAttribute('data-msg-base') || 'ddc-msg-line') + (kind ? ' is-' + kind : '');
    }

    function setAuditMsg(text, kind) {
      if (!els.auditMsg) return;
      els.auditMsg.textContent = text || '';
      els.auditMsg.className = 'ddc-audit-msg' + (kind ? ' is-' + kind : '');
    }

    function showAlert(text) {
      if (!els.alert) return;
      els.alert.textContent = text;
      els.alert.className = 'ddc-alert is-on';
      if (alertTimer) clearTimeout(alertTimer);
      alertTimer = setTimeout(function () {
        if (els.alert) els.alert.className = 'ddc-alert';
      }, 9000);
    }

    /* A destructive button click must be repeated within 4s. */
    function needConfirm(key, btn, label, action) {
      var now = Date.now();
      if (confirms[key] && now - confirms[key] < 4000) {
        delete confirms[key];
        if (btn) btn.textContent = label;
        action();
        return;
      }
      confirms[key] = now;
      if (btn) btn.textContent = '再点一次确认';
      setTimeout(function () {
        if (confirms[key] === now) {
          delete confirms[key];
          if (btn && btn.isConnected) btn.textContent = label;
        }
      }, 4000);
    }

    /* ------------------------------------------------------------------ */
    /* 12. Rendering                                                       */
    /* ------------------------------------------------------------------ */

    function itemHtml(item, index, done, kind) {
      return '<div class="ddc-item' + (done ? ' is-done' : '') + '" data-kind="' + kind + '" data-i="' + index + '"' +
        ' role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '" tabindex="0">' +
        '<span class="ddc-box"></span>' +
        '<span class="ddc-text"><b>' + escapeHtml(item.label) + '</b>' +
        (item.hint ? '<em>' + escapeHtml(item.hint) + '</em>' : '') +
        '</span></div>';
    }

    function updateHeader() {
      if (!els.date) return;
      els.date.textContent = fmtDateLong(new Date());
    }

    function updateToday() {
      if (!root) return;
      var now = new Date();
      var key = keyOf(now);
      renderedKey = key;

      var week = weekFor(now);
      var flags = dayFlags(key);
      var items = weekFlags(week);
      var done = doneCount(flags);
      var total = flags.length;
      var weekDone = doneCount(items);

      els.wk.textContent = week.label;
      els.phase.textContent = week.phase ? '· ' + week.phase : '';
      els.range.textContent = week.range || '';
      els.goal.innerHTML = week.goal ? '<b>本周：</b>' + escapeHtml(week.goal) : '';

      var todayHtml = '';
      for (var i = 0; i < plan.daily.length; i++) {
        todayHtml += itemHtml(plan.daily[i], i, !!flags[i], 'day');
      }
      els.today.innerHTML = todayHtml;

      var weekHtml = '';
      if (week.items.length) {
        for (var j = 0; j < week.items.length; j++) {
          weekHtml += itemHtml({ label: week.items[j] }, j, !!items[j], 'week');
        }
      } else {
        weekHtml = '<div class="ddc-empty">这一周没有清单项。</div>';
      }
      els.weekList.innerHTML = weekHtml;
      els.weekCount.textContent = week.items.length ? ('· ' + weekDone + '/' + week.items.length) : '';

      els.fill.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
      els.count.textContent = done + '/' + total;

      var days = streak(now);
      els.streak.textContent = days > 0 ? '连续 ' + days + ' 天已通过' : '';
      els.streak.className = 'ddc-streak' + (days > 0 ? ' is-on' : '');

      var rec = recordFor(key);
      var approved = !!rec.a && isFull(rec.f);
      updateAudit(rec, approved, done, total);
      applyNag(now, done, total, approved);
      applyCollapse(done, total, approved);
      applyPos();
    }

    function applyNag(now, done, total, approved) {
      if (!els.nag) return;
      var nag = nagFor(now, done, total, approved);
      els.nag.className = 'ddc-nag' + (nag.tone ? ' is-' + nag.tone : '');
      els.nag.textContent = nag.text;
    }

    function applyCollapse(done, total, approved) {
      if (!pill) return;
      pill.className = 'ddc-pill' + (state.collapsed ? ' is-on' : '');
      pill.setAttribute('aria-hidden', state.collapsed ? 'false' : 'true');
      root.style.display = state.collapsed ? 'none' : '';
      var dot = approved ? ' is-ok' : (done === total ? ' is-wait' : '');
      pill.innerHTML = '<span class="ddc-pill-dot' + dot + '"></span><span>今日 ' + done + '/' + total + (approved ? ' ✓' : '') + '</span>';
    }

    function updateAudit(rec, approved, done, total) {
      if (!els.auditState) return;
      if (beforeStart(new Date())) {
        els.auditState.textContent = '考勤：还没开始';
        els.auditState.className = '';
        els.auditToggle.textContent = '未开始';
        els.auditToggle.disabled = true;
        els.auditForm.className = 'ddc-audit-form';
        return;
      }
      if (approved) {
        els.auditState.textContent = '考勤：已通过 AI 审批 ✓';
        els.auditState.className = 'is-ok';
      } else if (done === total) {
        els.auditState.textContent = '考勤：待 AI 审批';
        els.auditState.className = 'is-wait';
      } else {
        els.auditState.textContent = '考勤：进行中 ' + done + '/' + total;
        els.auditState.className = '';
      }
      els.auditToggle.textContent = approved ? '已通过' : '提交审批';
      els.auditToggle.disabled = approved;
      els.auditForm.className = 'ddc-audit-form' + (!approved && state.auditOpen ? ' is-open' : '');
      if (document.activeElement !== els.proof) els.proof.value = rec.p || '';
    }

    function updateReview() {
      if (!els.revText) return;
      var key = state.reviewDate || todayKey();
      state.reviewDate = key;
      var day = parseDateKey(key) || new Date();
      var isToday = key === todayKey();
      els.revLabel.textContent = isToday ? '今天的复盘' : (day.getMonth() + 1) + '月' + day.getDate() + '日 ' + WEEKDAYS[(day.getDay() + 6) % 7];
      if (document.activeElement !== els.revDate) els.revDate.value = key;
      els.revDate.max = todayKey();

      var rec = reviewForKey(key);
      setArea(els.revText, rec ? rec.t : '');
      if (rec) {
        els.revStat.textContent = '上次保存 ' + fmtTs(rec.u) + ' · ' + charCount(rec.t) + ' 字';
      } else {
        els.revStat.textContent = '还没写';
      }
      renderReviewList();
    }

    function renderReviewList() {
      if (!els.revList) return;
      var keys = [];
      for (var k in state.reviews) {
        if (!Object.prototype.hasOwnProperty.call(state.reviews, k)) continue;
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) keys.push(k);
      }
      keys.sort();
      keys.reverse();
      keys = keys.slice(0, 30);
      if (!keys.length) {
        els.revList.innerHTML = '<div class="ddc-empty">写第一篇复盘吧，三句话就够。</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < keys.length; i++) {
        var rec = state.reviews[keys[i]];
        var d = parseDateKey(keys[i]);
        var label = d ? ((d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[(d.getDay() + 6) % 7]) : keys[i];
        html += '<div class="ddc-row' + (keys[i] === state.reviewDate ? ' is-on' : '') + '" data-row="rev" data-key="' + keys[i] + '">' +
          '<div class="d"><span>' + escapeHtml(label) + '</span><span>' + charCount(rec.t) + ' 字</span>' +
          '<span>' + escapeHtml(fmtTs(rec.u)) + '</span></div>' +
          '<div class="t">' + escapeHtml(rec.t) + '</div></div>';
      }
      els.revList.innerHTML = html;
    }

    function updateNotes() {
      if (!els.noteList) return;
      els.noteStat.textContent = state.notes.length ? (state.notes.length + ' 条笔记') : '';
      var note = state.editingNote ? noteById(state.editingNote) : null;
      if (note) {
        els.noteEditor.className = 'ddc-editor is-open';
        setArea(els.noteTitle, note.t);
        setArea(els.noteBody, note.b);
        if (els.noteMsg && !els.noteMsg.textContent) {
          setMsg(els.noteMsg, note.b ? ('上次保存 ' + fmtTs(note.u)) : '开始写吧，自动保存。');
        }
      } else {
        els.noteEditor.className = 'ddc-editor';
      }
      renderNoteList();
    }

    function renderNoteList() {
      if (!els.noteList) return;
      var list = state.notes.slice(0);
      list.sort(function (a, b) { return (b.u || 0) - (a.u || 0); });
      if (!list.length) {
        els.noteList.innerHTML = '<div class="ddc-empty">还没有笔记。点「新建笔记」写第一条。</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        var title = trimStr(n.t) || trimStr(n.b.split('\n')[0]).slice(0, 18) || '无标题';
        html += '<div class="ddc-row' + (n.id === state.editingNote ? ' is-on' : '') + '" data-row="note" data-id="' + escapeHtml(n.id) + '">' +
          '<div class="d"><span>' + escapeHtml(fmtTs(n.u)) + '</span><span>' + charCount(n.b) + ' 字</span></div>' +
          '<div class="t"><b>' + escapeHtml(title) + '</b>' + (n.b ? '  ' + escapeHtml(n.b) : '') + '</div></div>';
      }
      els.noteList.innerHTML = html;
    }

    function updatePlanSummary() {
      if (!els.planCard) return;
      var now = new Date();
      var week = weekFor(now);
      var lines = [];
      lines.push('<b>' + escapeHtml(plan.name) + '</b>');
      lines.push('开始 ' + escapeHtml(plan.start) + ' · 每天 ' + plan.daily.length + ' 项 · 共 ' +
        plan.weeks.length + ' 周' + (plan.after ? ' + 后续安排' : ''));
      lines.push('现在：' + escapeHtml(week.label) + (week.range ? '（' + escapeHtml(week.range) + '）' : ''));
      if (week.goal) lines.push('本周目标：' + escapeHtml(week.goal));
      els.planCard.innerHTML = lines.join('<br>');
    }

    function applyTab() {
      var tab = state.tab || 'today';
      if (TAB_KEYS.indexOf(tab) < 0) tab = 'today';
      for (var i = 0; i < TAB_KEYS.length; i++) {
        var key = TAB_KEYS[i];
        var pane = paneEls[key];
        if (pane) pane.className = 'ddc-pane' + (key === tab ? ' is-active' : '');
      }
      var tabs = { today: els.tabToday, review: els.tabReview, notes: els.tabNotes, plan: els.tabPlan };
      for (var k in tabs) {
        if (!Object.prototype.hasOwnProperty.call(tabs, k)) continue;
        var btn = tabs[k];
        if (!btn) continue;
        var on = k === tab;
        btn.className = 'ddc-tab' + (on ? ' is-active' : '');
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }

    function renderAll() {
      updateHeader();
      updateToday();
      updateReview();
      updateNotes();
      updatePlanSummary();
      applyTab();
      applyPos();
    }

    /* ------------------------------------------------------------------ */
    /* 13. Copy / download                                                 */
    /* ------------------------------------------------------------------ */

    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (err) { return false; }
    }

    function copyText(text, cb) {
      var done = function (ok) { if (cb) cb(!!ok); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
          return;
        }
      } catch (err) { /* fall through */ }
      done(legacyCopy(text));
    }

    function downloadText(filename, text, mime) {
      try {
        var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          try { URL.revokeObjectURL(url); } catch (err) { /* ignore */ }
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 1500);
        return true;
      } catch (err) { return false; }
    }

    /* ------------------------------------------------------------------ */
    /* 14. Review tab                                                      */
    /* ------------------------------------------------------------------ */

    function flushReview() {
      if (revTimer) { clearTimeout(revTimer); revTimer = null; }
      if (!els.revText) return;
      var key = state.reviewDate || todayKey();
      var text = els.revText.value;
      var before = state.reviews[key] ? state.reviews[key].t : '';
      if (textOf(before) === textOf(text)) {
        if (els.revStat) els.revStat.textContent = text.trim() ? ('已保存 ' + charCount(text) + ' 字') : '还没写';
        return;
      }
      saveReview(key, text);
      if (els.revStat) {
        els.revStat.textContent = text.trim()
          ? '已保存 ' + hhmm(new Date()) + ' · ' + charCount(text) + ' 字'
          : '还没写';
      }
      renderReviewList();
    }

    function scheduleReviewSave() {
      if (revTimer) clearTimeout(revTimer);
      revTimer = setTimeout(flushReview, 500);
      if (els.revStat) els.revStat.textContent = '保存中…';
    }

    function switchReviewDate(nextKey) {
      flushReview();
      var d = parseDateKey(nextKey);
      if (!d) return;
      if (keyOf(d) > todayKey()) d = new Date();
      state.reviewDate = keyOf(d);
      saveState();
      /* A focused textarea would keep its old value: blur it first. */
      if (els.revText && document.activeElement === els.revText) {
        try { els.revText.blur(); } catch (err) { /* ignore */ }
      }
      updateReview();
    }

    function reviewMarkdown() {
      var keys = [];
      for (var k in state.reviews) {
        if (!Object.prototype.hasOwnProperty.call(state.reviews, k)) continue;
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) keys.push(k);
      }
      keys.sort();
      var out = ['# 复盘记录 · ' + plan.name, ''];
      for (var i = 0; i < keys.length; i++) {
        var d = parseDateKey(keys[i]);
        out.push('## ' + keys[i] + ' ' + (d ? WEEKDAYS[(d.getDay() + 6) % 7] : ''));
        out.push('');
        out.push(state.reviews[keys[i]].t);
        out.push('');
      }
      return out.join('\n').trim() + '\n';
    }

    function insertIntoReview(snippet) {
      if (!els.revText) return;
      var node = els.revText;
      var start = typeof node.selectionStart === 'number' ? node.selectionStart : node.value.length;
      var end = typeof node.selectionEnd === 'number' ? node.selectionEnd : node.value.length;
      var before = node.value.slice(0, start);
      var pad = (!before || /\n$/.test(before)) ? '' : '\n';
      var insert = pad + snippet + '\n';
      node.value = before + insert + node.value.slice(end);
      var caret = before.length + insert.length;
      try { node.focus(); node.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
      scheduleReviewSave();
    }

    /* ------------------------------------------------------------------ */
    /* 15. Notes tab                                                       */
    /* ------------------------------------------------------------------ */

    function flushNote() {
      if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
      if (!els.noteBody) return;
      var note = state.editingNote ? noteById(state.editingNote) : null;
      if (!note) return;
      var title = els.noteTitle ? els.noteTitle.value : '';
      var body = els.noteBody.value;
      if (note.t === title && note.b === body) return;
      note.t = title;
      note.b = body;
      note.u = Date.now();
      saveState();
      if (els.noteMsg) setMsg(els.noteMsg, '已保存 ' + hhmm(new Date()), 'ok');
      renderNoteList();
      renderNoteStat();
    }

    function scheduleNoteSave() {
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(flushNote, 500);
      if (els.noteMsg) setMsg(els.noteMsg, '保存中…');
    }

    function renderNoteStat() {
      if (els.noteStat) els.noteStat.textContent = state.notes.length ? (state.notes.length + ' 条笔记') : '';
    }

    function noteById(id) {
      for (var i = 0; i < state.notes.length; i++) {
        if (state.notes[i].id === id) return state.notes[i];
      }
      return null;
    }

    function createNote() {
      var id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      var note = { id: id, t: '', b: '', u: Date.now() };
      state.notes.unshift(note);
      saveState();
      return note;
    }

    /* Switching notes must not leak the previous text into the next one:
       flush the current note first, then hard-set the editor fields. */
    function openNote(id) {
      flushNote();
      state.editingNote = id;
      saveState();
      if (els.noteMsg) setMsg(els.noteMsg, '');
      if (els.noteTitle && document.activeElement === els.noteTitle) {
        try { els.noteTitle.blur(); } catch (err) { /* ignore */ }
      }
      if (els.noteBody && document.activeElement === els.noteBody) {
        try { els.noteBody.blur(); } catch (err) { /* ignore */ }
      }
      updateNotes();
      var note = noteById(id);
      if (note) {
        if (els.noteTitle) els.noteTitle.value = note.t;
        if (els.noteBody) els.noteBody.value = note.b;
      }
    }

    function closeNote() {
      flushNote();
      state.editingNote = null;
      saveState();
      if (els.noteMsg) setMsg(els.noteMsg, '');
      updateNotes();
    }

    /* ------------------------------------------------------------------ */
    /* 16. Plan tab                                                        */
    /* ------------------------------------------------------------------ */

    function planJson() { return JSON.stringify(plan, null, 2); }

    function openPlanEditor(mode) {
      if (!els.planEditor) return;
      editorMode = mode;
      els.planEditor.className = 'ddc-editor is-open';
      if (mode === 'edit') {
        els.planMode.textContent = '编辑计划 JSON（改完点「保存并应用」）';
        els.planText.value = planJson();
        els.planText.placeholder = '';
        els.planApply.textContent = '保存并应用';
      } else if (mode === 'import') {
        els.planMode.textContent = '导入新计划：粘贴 JSON，或从文件读取';
        els.planText.value = '';
        els.planText.placeholder = '{\n  "name": "新计划",\n  "start": "2026-11-16",\n  "daily": ["项目 60 分钟", "LeetCode 1 题"],\n  "weeks": [\n    { "goal": "本周目标", "items": ["清单 1", "清单 2"] }\n  ]\n}';
        els.planApply.textContent = '导入';
      } else {
        els.planMode.textContent = '恢复备份：粘贴备份 JSON，或从文件读取';
        els.planText.value = '';
        els.planText.placeholder = '把「下载备份」得到的 JSON 全文粘到这里';
        els.planApply.textContent = '恢复';
      }
      if (els.planChars) {
        els.planChars.textContent = els.planText.value ? (els.planText.value.length + ' 字符') : '';
      }
      setMsg(els.planEditorMsg, '');
      try { els.planText.focus(); } catch (err) { /* ignore */ }
    }

    function closePlanEditor() {
      editorMode = null;
      if (els.planEditor) els.planEditor.className = 'ddc-editor';
      setMsg(els.planEditorMsg, '');
    }

    function applyPlanText() {
      if (!editorMode) return;
      var raw = els.planText ? els.planText.value.trim() : '';
      if (!raw) { setMsg(els.planEditorMsg, '先把 JSON 粘进来。', 'err'); return; }

      var parsed = null;
      try { parsed = JSON.parse(raw); }
      catch (err) { setMsg(els.planEditorMsg, 'JSON 解析失败：' + err.message, 'err'); return; }

      if (editorMode === 'backup') { restoreBackup(parsed); return; }

      var res = normalizePlan(parsed);
      if (!res.ok) {
        setMsg(els.planEditorMsg, '计划有问题：' + res.errors.slice(0, 4).join('；'), 'err');
        return;
      }
      var next = res.plan;
      savePlan(next);
      state.editingNote = null;
      closePlanEditor();
      updatePlanSummary();
      renderAll();
      setMsg(els.planMsg, '计划已切换：' + plan.name + '（' + plan.weeks.length + ' 周 / 每天 ' + plan.daily.length + ' 项）。打卡历史保留，周清单按新计划重新计。', 'ok');
    }

    function backupPayload() {
      return JSON.stringify({
        kind: 'dsh-daily-coach.backup',
        v: STATE_VERSION,
        exportedAt: new Date().toISOString(),
        plan: plan,
        state: state
      }, null, 2);
    }

    function restoreBackup(parsed) {
      if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'dsh-daily-coach.backup') {
        setMsg(els.planEditorMsg, '这不是本插件的备份：缺少 kind = dsh-daily-coach.backup。', 'err');
        return;
      }
      var s = parsed.state;
      if (!s || typeof s !== 'object') {
        setMsg(els.planEditorMsg, '备份里没有 state。', 'err');
        return;
      }
      if (parsed.plan) {
        var res = normalizePlan(parsed.plan);
        if (res.ok) savePlan(res.plan);
      }
      var fresh = blankState();
      var adopted = adoptState(fresh, s);
      adopted.reviewDate = parseDateKey(s.reviewDate) ? s.reviewDate : todayKey();
      adopted.editingNote = null;
      state = adopted;
      saveState();
      closePlanEditor();
      renderAll();
      setMsg(els.planMsg, '备份已恢复：' + Object.keys(state.days).length + ' 天打卡 · ' +
        Object.keys(state.reviews).length + ' 篇复盘 · ' + state.notes.length + ' 条笔记。', 'ok');
    }

    /* ------------------------------------------------------------------ */
    /* 17. Approval (unchanged from v0.1)                                  */
    /* ------------------------------------------------------------------ */

    function requestText(rec, key) {
      var lines = ['【每日考勤审批】', '日期：' + key];
      for (var i = 0; i < plan.daily.length; i++) {
        lines.push(plan.daily[i].label + '：' + (rec.f[i] ? '完成' : '未完成'));
      }
      lines.push('备注：' + rec.p);
      lines.push('请审核，通过就把审批码发给我。');
      return lines.join('\n');
    }

    function copyRequest() {
      var key = todayKey();
      var rec = recordFor(key);
      if (!isFull(rec.f)) { setAuditMsg('今天的项目还没做完，先别申请。', 'err'); return; }
      var proof = normProof(els.proof.value);
      if (proof.length < 5) { setAuditMsg('先写两句今天实际做了什么。', 'err'); return; }
      rec.p = proof;
      saveState();
      var text = requestText(rec, key);
      copyText(text, function (ok) {
        if (ok) {
          setAuditMsg('已复制，粘贴到 DSH 对话框发给我。', 'ok');
          return;
        }
        if (els.requestOut) {
          els.requestOut.value = text;
          els.requestOut.className = 'ddc-request is-open';
        }
        setAuditMsg('复制失败：下面全文已展开，手动全选复制。', 'err');
      });
    }

    function submitApproval() {
      var key = todayKey();
      var rec = recordFor(key);
      if (!isFull(rec.f)) { setAuditMsg('今天的项目没做完，不能审批。', 'err'); return; }
      rec.p = normProof(els.proof.value);
      if (!rec.p) { setAuditMsg('备注不能为空。', 'err'); return; }
      var input = String(els.code.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (input.length !== 6) { setAuditMsg('审批码是 6 位，别抄漏。', 'err'); return; }
      if (input !== expectedCode(key, rec.p)) { setAuditMsg('审批码不对，或备注和发给 AI 的不一致。', 'err'); return; }
      rec.a = true;
      rec.c = input;
      rec.at = Date.now();
      state.auditOpen = false;
      saveState();
      updateToday();
    }

    /* ------------------------------------------------------------------ */
    /* 18. Toggle / drag                                                   */
    /* ------------------------------------------------------------------ */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function bounded(left, top, w, h) {
      return {
        left: clamp(left, 8, Math.max(8, window.innerWidth - w - 8)),
        top: clamp(top, 8, Math.max(8, window.innerHeight - h - 8))
      };
    }

    function applyPos() {
      if (!state.pos || !root || !pill) return;
      var p = state.pos;
      var rb = bounded(p.left, p.top, root.offsetWidth || 336, root.offsetHeight || 460);
      root.style.left = rb.left + 'px';
      root.style.top = rb.top + 'px';
      root.style.right = 'auto';
      var pb = bounded(p.left, p.top, pill.offsetWidth || 96, pill.offsetHeight || 32);
      pill.style.left = pb.left + 'px';
      pill.style.top = pb.top + 'px';
      pill.style.right = 'auto';
    }

    function onDragMove(ev) {
      if (!drag) return;
      var el = drag.el;
      var pos = bounded(ev.clientX - drag.dx, ev.clientY - drag.dy, el.offsetWidth, el.offsetHeight);
      el.style.left = pos.left + 'px';
      el.style.top = pos.top + 'px';
      el.style.right = 'auto';
      if (Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY) > 3) drag.moved = true;
      if (ev.cancelable) ev.preventDefault();
    }

    function endDrag() {
      if (!drag) return;
      var el = drag.el;
      var rect = el.getBoundingClientRect();
      if (drag.moved) {
        state.pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
        saveState();
        if (el === pill) pillDraggedAt = Date.now();
      }
      el.style.cursor = '';
      drag = null;
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    }

    function startDrag(ev, el, prevent) {
      if (ev.button !== 0) return;
      if (drag) endDrag();
      var rect = el.getBoundingClientRect();
      drag = {
        el: el,
        dx: ev.clientX - rect.left,
        dy: ev.clientY - rect.top,
        startX: ev.clientX,
        startY: ev.clientY,
        moved: false
      };
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.cursor = 'grabbing';
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
      if (prevent !== false && ev.cancelable) ev.preventDefault();
    }

    function onRootPointerDown(ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-act="collapse"]')) return;
      if (t.closest('input') || t.closest('textarea') || t.closest('button')) return;
      if (!t.closest('.ddc-head')) return;
      startDrag(ev, root);
    }

    function onResize() {
      if (drag || !state.pos) return;
      applyPos();
    }

    function toggle(kind, index) {
      var now = new Date();
      if (kind === 'day') {
        var flags = dayFlags(keyOf(now));
        if (index < 0 || index >= flags.length) return;
        flags[index] = !flags[index];
      } else if (kind === 'week') {
        var week = weekFor(now);
        var items = weekFlags(week);
        if (index < 0 || index >= items.length) return;
        items[index] = !items[index];
      } else {
        return;
      }
      saveState();
      updateToday();
    }

    /* ------------------------------------------------------------------ */
    /* 19. Actions                                                         */
    /* ------------------------------------------------------------------ */

    function switchTab(tab) {
      if (TAB_KEYS.indexOf(tab) < 0) return;
      if (state.tab === tab) return;
      flushReview();
      flushNote();
      state.tab = tab;
      saveState();
      applyTab();
      if (tab === 'review') updateReview();
      if (tab === 'notes') updateNotes();
      if (tab === 'plan') updatePlanSummary();
    }

    function handleRow(el) {
      var kind = el.getAttribute('data-row');
      if (kind === 'rev') {
        switchReviewDate(el.getAttribute('data-key'));
        return;
      }
      if (kind === 'note') {
        openNote(el.getAttribute('data-id'));
      }
    }

    function handleAct(act, el) {
      switch (act) {
        case 'collapse':
          state.collapsed = !state.collapsed;
          saveState();
          applyCollapse(doneCount(dayFlags(todayKey())), plan.daily.length,
            approvedAt(todayKey()));
          applyPos();
          break;

        case 'audit-toggle':
          var rec = recordFor(todayKey());
          if (!isFull(rec.f)) {
            state.auditOpen = true;
            saveState();
            updateToday();
            setAuditMsg('先把今天的项目做完，再来审批。', 'err');
            return;
          }
          state.auditOpen = !state.auditOpen;
          saveState();
          updateToday();
          break;

        case 'audit-copy': copyRequest(); break;
        case 'audit-submit': submitApproval(); break;

        case 'rev-prev': switchReviewDate(keyOf(shift(parseDateKey(state.reviewDate) || new Date(), -1))); break;
        case 'rev-next': switchReviewDate(keyOf(shift(parseDateKey(state.reviewDate) || new Date(), 1))); break;
        case 'rev-today': switchReviewDate(todayKey()); break;
        case 'rev-tpl-learn': insertIntoReview('· 今天学到：'); break;
        case 'rev-tpl-stuck': insertIntoReview('· 卡住的地方：'); break;
        case 'rev-tpl-next': insertIntoReview('· 明天第一件事：'); break;

        case 'rev-proof':
          flushReview();
          var text = reviewForKey(state.reviewDate || todayKey());
          if (!text) { setMsg(els.revMsg, '这一天还没写复盘。', 'err'); return; }
          els.proof.value = normProof(text.t).slice(0, 800);
          if (isFull(recordFor(todayKey()).f)) state.auditOpen = true;
          saveState();
          updateToday();
          setMsg(els.revMsg, '已填入审批备注，去「今日」页复制审批请求。', 'ok');
          break;

        case 'rev-copy':
          flushReview();
          copyText(reviewMarkdown(), function (ok) {
            setMsg(els.revMsg, ok ? '全部复盘已复制（Markdown）。' : '复制失败，可以换「下载 .md」。', ok ? 'ok' : 'err');
          });
          break;

        case 'rev-download':
          flushReview();
          var okFile = downloadText('复盘-' + todayKey() + '.md', reviewMarkdown(), 'text/markdown;charset=utf-8');
          setMsg(els.revMsg, okFile ? '已下载 复盘-' + todayKey() + '.md' : '下载失败。', okFile ? 'ok' : 'err');
          break;

        case 'note-new':
          flushNote();
          openNote(createNote().id);
          if (els.noteTitle) { try { els.noteTitle.focus(); } catch (err) { /* ignore */ } }
          break;

        case 'note-done': closeNote(); break;

        case 'note-del':
          var note = state.editingNote ? noteById(state.editingNote) : null;
          if (!note) return;
          needConfirm('note-del', el, '删除', function () {
            closeNote();
            for (var i = 0; i < state.notes.length; i++) {
              if (state.notes[i].id === note.id) { state.notes.splice(i, 1); break; }
            }
            saveState();
            updateNotes();
          });
          break;

        case 'note-copy':
          flushNote();
          var cur = state.editingNote ? noteById(state.editingNote) : null;
          if (!cur) return;
          copyText((trimStr(cur.t) ? cur.t + '\n\n' : '') + cur.b, function (ok) {
            setMsg(els.noteMsg, ok ? '笔记已复制。' : '复制失败。', ok ? 'ok' : 'err');
          });
          break;

        case 'plan-edit': openPlanEditor('edit'); break;
        case 'plan-import': openPlanEditor('import'); break;
        case 'plan-cancel': closePlanEditor(); break;
        case 'plan-apply': applyPlanText(); break;

        case 'plan-file':
          if (els.planFile) els.planFile.click();
          break;

        case 'plan-copy':
          copyText(planJson(), function (ok) {
            setMsg(els.planMsg, ok ? '当前计划 JSON 已复制。' : '复制失败，可以换「下载 .json」。', ok ? 'ok' : 'err');
          });
          break;

        case 'plan-download':
          var name = 'plan-' + (plan.id || 'custom') + '.json';
          var okPlan = downloadText(name, planJson());
          setMsg(els.planMsg, okPlan ? '已下载 ' + name : '下载失败。', okPlan ? 'ok' : 'err');
          break;

        case 'plan-reset':
          needConfirm('plan-reset', el, '恢复默认', function () {
            savePlan(clone(DEFAULT_PLAN));
            closePlanEditor();
            renderAll();
            setMsg(els.planMsg, '已恢复默认计划（打卡历史保留）。', 'ok');
          });
          break;

        case 'backup-copy':
          copyText(backupPayload(), function (ok) {
            setMsg(els.planMsg, ok ? '备份已复制（含打卡、复盘、笔记、计划）。' : '复制失败，可以换「下载备份」。', ok ? 'ok' : 'err');
          });
          break;

        case 'backup-download':
          var bname = 'dsh-daily-coach-backup-' + todayKey() + '.json';
          var okB = downloadText(bname, backupPayload());
          setMsg(els.planMsg, okB ? '已下载 ' + bname : '下载失败。', okB ? 'ok' : 'err');
          break;

        case 'backup-import': openPlanEditor('backup'); break;

        default: break;
      }
    }

    function onClick(ev) {
      var target = ev.target;
      if (!target || !target.closest) return;
      var actEl = target.closest('[data-act]');
      if (actEl) { handleAct(actEl.getAttribute('data-act'), actEl); return; }
      var tabEl = target.closest('[data-tab]');
      if (tabEl) { switchTab(tabEl.getAttribute('data-tab')); return; }
      var kindEl = target.closest('[data-kind]');
      if (kindEl) {
        toggle(kindEl.getAttribute('data-kind'), parseInt(kindEl.getAttribute('data-i'), 10));
        return;
      }
      var rowEl = target.closest('[data-row]');
      if (rowEl) { handleRow(rowEl); return; }
    }

    function onKeyDown(ev) {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      var row = ev.target && ev.target.closest ? ev.target.closest('[data-kind]') : null;
      if (!row) return;
      if (ev.target.closest && (ev.target.closest('button') || ev.target.closest('input') || ev.target.closest('textarea'))) return;
      ev.preventDefault();
      toggle(row.getAttribute('data-kind'), parseInt(row.getAttribute('data-i'), 10));
    }

    function onInput(ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var ref = t.getAttribute('data-ref');
      if (ref === 'revText') scheduleReviewSave();
      else if (ref === 'noteTitle' || ref === 'noteBody') scheduleNoteSave();
      else if (ref === 'planText') {
        if (els.planChars) els.planChars.textContent = (t.value || '').length + ' 字符';
      }
    }

    function onChange(ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var ref = t.getAttribute('data-ref');
      if (ref === 'revDate') { switchReviewDate(t.value || todayKey()); return; }
      if (ref === 'planFile') {
        var file = t.files && t.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          if (els.planText) {
            els.planText.value = String(reader.result || '');
            if (els.planChars) els.planChars.textContent = els.planText.value.length + ' 字符';
          }
          setMsg(els.planEditorMsg, '已读入 ' + file.name + '，检查没问题再点「' +
            (editorMode === 'backup' ? '恢复' : (editorMode === 'import' ? '导入' : '保存并应用')) + '」。', 'ok');
        };
        reader.onerror = function () { setMsg(els.planEditorMsg, '读文件失败。', 'err'); };
        try { reader.readAsText(file, 'utf-8'); }
        catch (err) { setMsg(els.planEditorMsg, '读文件失败：' + err.message, 'err'); }
        t.value = '';
      }
    }

    /* ------------------------------------------------------------------ */
    /* 20. Tick / mount                                                    */
    /* ------------------------------------------------------------------ */

    function tick() {
      var now = new Date();
      var key = keyOf(now);
      if (key !== renderedKey) {
        if (state.reviewDate === renderedKey) state.reviewDate = key;
        updateHeader();
        updateToday();
        updateReview();
        updatePlanSummary();
        return;
      }
      if (!els.nag) return;
      var flags = dayFlags(renderedKey);
      applyNag(now, doneCount(flags), flags.length, approvedAt(renderedKey));
    }

    function flushAll() {
      flushReview();
      flushNote();
    }

    function onBeforeUnload() { flushAll(); }

    function mount() {
      if (!document.body) return null;
      /* A reload or a second injection must not leave a duplicate panel. */
      var staleRoot = document.getElementById(ROOT_ID);
      if (staleRoot) staleRoot.remove();
      var stalePill = document.getElementById(PILL_ID);
      if (stalePill) stalePill.remove();
      var staleStyle = document.getElementById(STYLE_ID);
      if (staleStyle) staleStyle.remove();

      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);

      var host = document.createElement('div');
      host.id = ROOT_ID;
      host.setAttribute('role', 'complementary');
      host.setAttribute('aria-label', '今日任务');
      host.innerHTML = TEMPLATE;
      document.body.appendChild(host);

      var pillEl = document.createElement('div');
      pillEl.id = PILL_ID;
      pillEl.className = 'ddc-pill';
      pillEl.setAttribute('role', 'button');
      pillEl.setAttribute('tabindex', '0');
      pillEl.setAttribute('aria-label', '展开今日任务');
      pillEl.addEventListener('pointerdown', function (ev) {
        /* Do not preventDefault here: the pill's own click must survive. */
        startDrag(ev, pillEl, false);
      });
      pillEl.addEventListener('click', function () {
        if (Date.now() - pillDraggedAt < 400) return;
        state.collapsed = false;
        saveState();
        updateToday();
        applyPos();
      });
      pillEl.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          state.collapsed = false;
          saveState();
          updateToday();
          applyPos();
        }
      });
      document.body.appendChild(pillEl);

      root = host;
      pill = pillEl;
      els = {};
      paneEls = {};
      refs(host);

      host.addEventListener('click', onClick);
      host.addEventListener('keydown', onKeyDown);
      host.addEventListener('input', onInput);
      host.addEventListener('change', onChange);
      host.addEventListener('pointerdown', onRootPointerDown);
      window.addEventListener('resize', onResize);
      window.addEventListener('beforeunload', onBeforeUnload);

      storageHandler = function (ev) {
        if (ev.key !== STATE_KEY && ev.key !== PLAN_KEY && ev.key !== LEGACY_STATE_KEY) return;
        plan = loadPlan();
        state = loadState();
        renderAll();
      };
      window.addEventListener('storage', storageHandler);

      if (migratedFromV1) {
        /* v0.1 data was read once; write the v2 snapshot right away so the
           migration survives a reload without any interaction. */
        migratedFromV1 = false;
        saveState();
      }
      renderAll();
      if (!state.collapsed) {
        host.classList.add('ddc-pulse');
        setTimeout(function () { if (host) host.classList.remove('ddc-pulse'); }, 3200);
      }
      timer = setInterval(tick, 30000);
      return host;
    }

    function unmount() {
      flushAll();
      if (timer !== null) { clearInterval(timer); timer = null; }
      if (storageHandler) { window.removeEventListener('storage', storageHandler); storageHandler = null; }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (drag) {
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        drag = null;
      }
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
        root.removeEventListener('pointerdown', onRootPointerDown);
        root.remove();
        root = null;
      }
      if (pill) { pill.remove(); pill = null; }
      var style = document.getElementById(STYLE_ID);
      if (style) style.remove();
      els = {};
      paneEls = {};
      renderedKey = '';
      editorMode = null;
      if (revTimer) { clearTimeout(revTimer); revTimer = null; }
      if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
      if (alertTimer) { clearTimeout(alertTimer); alertTimer = null; }
    }

    /* ------------------------------------------------------------------ */
    /* 21. Plugin                                                          */
    /* ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(function () {
        var disposed = false;
        var retry = null;
        function boot() {
          if (disposed) return;
          if (!document.body) {
            retry = setTimeout(boot, 150);
            return;
          }
          /* A panel that cannot mount must never take the shell down. */
          try {
            mount();
          } catch (err) {
            if (window.console && console.error) console.error('[dsh-daily-coach] mount failed', err);
          }
        }
        boot();
        return function () {
          disposed = true;
          if (retry !== null) { clearTimeout(retry); retry = null; }
          unmount();
        };
      });
    }

    return { apply: apply };
  }
});
