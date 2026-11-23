/* ===================================================================
 * src/calendar.js — CAL：日历页（月视图 / 当日详情 / 未来 30 天 / 里程碑）
 *                   + 醒目提醒卡。
 *
 * 契约：dsh-calendar-coach/CONTRACT.md §1（片段规则）、§2（数据模型）、
 *       §3（HTTP API）、§5.2（CAL 契约）。
 *
 * 硬约束：
 *   - 纯 DOM、ES5 语法（var + function）、无框架、无外部资源、无 npm 依赖。
 *   - 本文件只声明一个顶层绑定 CAL，其余全部在 IIFE 内。
 *   - 不直接挂到页面 body 上：只往传入的 container / overlay / 自己建的
 *     fixed 层里画。
 *   - 类名一律 calc- 前缀；颜色只用 var(--dsw-alias-*, 兜底色)。
 *   - 所有 api 调用的失败都要降级，不能让页面白屏。
 * =================================================================== */

var CAL = (function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 0. 常量                                                             */
  /* ------------------------------------------------------------------ */

  var WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  var WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];

  var LUNAR_DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
  ];
  var LUNAR_MONTH_NAMES = [
    '正月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '冬月', '腊月'
  ];

  /* 公历固定节日（前端兜底；宿主 lunar.festivals 里给的优先合并且去重） */
  var SOLAR_FESTIVALS = {
    '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '03-12': '植树节',
    '04-01': '愚人节', '05-01': '劳动节', '05-04': '青年节', '06-01': '儿童节',
    '07-01': '建党节', '08-01': '建军节', '09-10': '教师节', '10-01': '国庆节',
    '12-24': '平安夜', '12-25': '圣诞节'
  };
  /* 农历固定节日，键为「月-日」 */
  var LUNAR_FESTIVALS = {
    '1-1': '春节', '1-15': '元宵节', '2-2': '龙抬头', '5-5': '端午节',
    '7-7': '七夕', '7-15': '中元节', '8-15': '中秋节', '9-9': '重阳节',
    '12-8': '腊八节'
  };

  var REM_KIND_LABEL = {
    event: '纪念日', ddl: 'DDL', milestone: '里程碑', digest: '每日早报'
  };

  var LUNAR_LIMIT = 5;            /* /lunar 并发上限 */
  var MAX_UPCOMING_ROWS = 24;     /* 未来 30 天列表最多展示多少条 */

  /* ------------------------------------------------------------------ */
  /* 1. 模块状态                                                         */
  /* ------------------------------------------------------------------ */

  var S = {
    mounted: false,
    destroyed: false,

    coach: null,
    api: null,
    overlay: null,
    onOpenCoachTab: null,

    pane: null,          /* renderPane 拿到的容器 */
    root: null,          /* 我们在 pane 里建的 .calc-root */
    els: null,           /* data-ref 索引 */
    styles: [],          /* 注入过的 <style>（pane 与 overlay 各可能有一份） */
    bound: false,

    data: null,          /* Api.state() 返回的 State */
    loading: false,
    error: '',
    entry: null,         /* { y, m } 当前月视图 */
    selected: '',        /* 选中日 YYYY-MM-DD */

    mode: '',            /* 'card' | 'page'，未设置时按容器宽度推断 */
    flash: null,
    flashTimer: null,
    paintTimer: null,
    focusDdl: false,

    lunar: {},           /* dateKey -> {text,month,day,leap,festivals} */
    lunarBusy: {},
    lunarQueue: [],
    lunarInflight: 0,
    lunarWarned: false,

    confirm: {},         /* 二次确认删除用 */
    opStyle: '',         /* '' 未定 / 'contract' 点号 / 'camel' 宿主驼峰，记住谁认过就不再多发一次失败请求 */

    form: null,          /* 事件表单状态 */
    ddlDraft: '',

    rem: null,           /* 当前提醒 */
    remQueue: [],
    remLayer: null,
    snoozeTimers: [],    /* 「10 分钟后再提醒」的本地定时器 */
    shown: {},
    soundOn: true,
    notifyAsked: false,
    audio: null
  };

  /* ------------------------------------------------------------------ */
  /* 2. 基础工具                                                         */
  /* ------------------------------------------------------------------ */

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function keyOfDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function todayKey() {
    return keyOfDate(new Date());
  }

  function isKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function parseKey(value) {
    if (!isKey(value)) return null;
    var parts = value.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function addDays(date, days) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function addYears(date, years) {
    return new Date(date.getFullYear() + years, date.getMonth(), date.getDate());
  }

  function dayDiff(from, to) {
    var a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    var b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
  }

  function diffKey(fromKey, toKey) {
    var a = parseKey(fromKey);
    var b = parseKey(toKey);
    if (!a || !b) return 0;
    return dayDiff(a, b);
  }

  function weekdayCn(date) {
    return '星期' + WEEKDAYS_CN[date.getDay()];
  }

  function fmtDateLong(date) {
    if (!date) return '';
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + weekdayCn(date);
  }

  function fmtMonthDay(date) {
    if (!date) return '';
    return (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }

  function fmtMonthTitle(view) {
    return view.y + '年' + view.m + '月';
  }

  function relText(key) {
    var n = diffKey(todayKey(), key);
    if (n === 0) return '今天';
    if (n === 1) return '明天';
    if (n === 2) return '后天';
    if (n === -1) return '昨天';
    if (n > 0) return '还有 ' + n + ' 天';
    return '已过 ' + (-n) + ' 天';
  }

  function relShort(key) {
    var n = diffKey(todayKey(), key);
    if (n === 0) return '今天';
    if (n > 0) return '还有 ' + n + ' 天';
    return '已过 ' + (-n) + ' 天';
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function setText(node, text) {
    if (!node) return;
    node.textContent = text == null ? '' : String(text);
  }

  function showEl(node, visible) {
    if (!node) return;
    node.hidden = !visible;
  }

  function connected(node) {
    return !!(node && node.isConnected);
  }

  function setFlag(node, name, on) {
    if (!node || !node.classList) return;
    try {
      if (on) node.classList.add(name);
      else node.classList.remove(name);
    } catch (err) { /* ignore */ }
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function uniqueList(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      if (out.indexOf(item) >= 0) continue;
      out.push(item);
    }
    return out;
  }

  function scrollIntoViewSafe(node) {
    if (!node || typeof node.scrollIntoView !== 'function') return;
    try {
      node.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      try { node.scrollIntoView(); } catch (err2) {}
    }
  }

  /* ------------------------------------------------------------------ */
  /* 3. 农历缓存（Api.lunar，按日期永久缓存；失败降级不打转）            */
  /* ------------------------------------------------------------------ */

  function lunarOf(key) {
    return (S.lunar && S.lunar[key]) || null;
  }

  function lunarMonthLabel(month, leap) {
    var m = parseInt(month, 10);
    if (!(m >= 1 && m <= 12)) return (m || '') + '月';
    return (leap ? '闰' : '') + LUNAR_MONTH_NAMES[m - 1];
  }

  function lunarDayLabel(day) {
    var d = parseInt(day, 10);
    if (!(d >= 1 && d <= 30)) return (d || '') + '日';
    return LUNAR_DAY_NAMES[d - 1];
  }

  /* 月视图格子里的小字：初一显示月名，其余显示日名 */
  function shortLunar(info) {
    if (!info) return '';
    if (typeof info.month === 'number' && typeof info.day === 'number') {
      return info.day === 1 ? lunarMonthLabel(info.month, info.leap) : lunarDayLabel(info.day);
    }
    var text = String(info.text || '');
    if (!text) return '';
    var cut = text.indexOf('年');
    if (cut >= 0) text = text.slice(cut + 1);
    var matched = /^(闰?[正一二三四五六七八九十冬腊]+月)/.exec(text);
    if (matched) {
      var rest = text.slice(matched[1].length);
      return rest ? rest : matched[1];
    }
    return text;
  }

  /* 「十月初八」这种纯月日写法 */
  function lunarShort(key) {
    var info = lunarOf(key);
    if (!info) return '';
    if (typeof info.month === 'number' && typeof info.day === 'number') {
      return lunarMonthLabel(info.month, info.leap) + lunarDayLabel(info.day);
    }
    return shortLunar(info);
  }

  /* 「丙午年十月初八」这种完整写法 */
  function lunarTextOf(key) {
    var info = lunarOf(key);
    if (!info) return '';
    if (info.text) return String(info.text);
    return lunarShort(key);
  }

  function festivalsOf(key) {
    var out = [];
    var info = lunarOf(key);
    var solar = SOLAR_FESTIVALS[key.slice(5)];
    if (solar) out.push(solar);
    if (info && typeof info.month === 'number' && typeof info.day === 'number' && !info.leap) {
      var lunarFestival = LUNAR_FESTIVALS[info.month + '-' + info.day];
      if (lunarFestival) out.push(lunarFestival);
    }
    if (info && Array.isArray(info.festivals)) {
      for (var i = 0; i < info.festivals.length; i++) {
        if (typeof info.festivals[i] === 'string' && info.festivals[i]) out.push(info.festivals[i]);
      }
    }
    if (key === todayKey() && S.data && S.data.today && Array.isArray(S.data.today.festivals)) {
      for (var j = 0; j < S.data.today.festivals.length; j++) {
        if (typeof S.data.today.festivals[j] === 'string' && S.data.today.festivals[j]) {
          out.push(S.data.today.festivals[j]);
        }
      }
    }
    return uniqueList(out);
  }

  function lunarEnsure(keys) {
    if (!keys || !keys.length) return;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!isKey(key) || S.lunar[key] || S.lunarBusy[key]) continue;
      S.lunarBusy[key] = true;
      S.lunarQueue.push(key);
    }
    if (S.lunarQueue.length > 400) S.lunarQueue = S.lunarQueue.slice(-400);
    lunarPump();
  }

  function lunarPump() {
    if (S.destroyed || !S.lunarQueue.length) return;
    var api = S.api;
    if (!api || typeof api.lunar !== 'function') {
      while (S.lunarQueue.length) {
        var skipped = S.lunarQueue.shift();
        S.lunar[skipped] = { text: '' };
        delete S.lunarBusy[skipped];
      }
      return;
    }
    while (S.lunarInflight < LUNAR_LIMIT && S.lunarQueue.length) {
      var key = S.lunarQueue.shift();
      if (S.lunar[key]) { delete S.lunarBusy[key]; continue; }
      S.lunarInflight++;
      try {
        Promise.resolve(api.lunar(key)).then(lunarDone(key), lunarFail(key));
      } catch (err) {
        lunarFail(key)();
      }
    }
  }

  function lunarDone(key) {
    return function (info) {
      S.lunarInflight = Math.max(0, S.lunarInflight - 1);
      delete S.lunarBusy[key];
      S.lunar[key] = (info && typeof info === 'object') ? info : { text: '' };
      schedulePaint();
      lunarPump();
    };
  }

  function lunarFail(key) {
    return function () {
      S.lunarInflight = Math.max(0, S.lunarInflight - 1);
      delete S.lunarBusy[key];
      S.lunar[key] = { text: '' };
      if (!S.lunarWarned) {
        S.lunarWarned = true;
        flash('农历加载失败，先按公历显示', 'error');
      }
      schedulePaint();
      lunarPump();
    };
  }

  function visibleLunarKeys() {
    var keys = [];
    var range = gridRange();
    var i;
    for (i = 0; i < 42; i++) keys.push(keyOfDate(addDays(range.start, i)));
    var base = parseKey(todayKey());
    for (i = 0; i <= 30; i++) keys.push(keyOfDate(addDays(base, i)));
    var anchors = anchorList();
    for (i = 0; i < anchors.length; i++) {
      var rows = milestoneRows(anchors[i]);
      for (var j = 0; j < rows.length; j++) keys.push(rows[j].dateKey);
    }
    if (S.selected) keys.push(S.selected);
    if (S.rem && S.rem.dateKey && isKey(S.rem.dateKey)) keys.push(S.rem.dateKey);
    return keys;
  }

  function ensureLunarForVisible() {
    lunarEnsure(visibleLunarKeys());
  }

  /* ------------------------------------------------------------------ */
  /* 4. 数据读取（State / Event / Ddl / Milestone）                       */
  /* ------------------------------------------------------------------ */

  function listOf(name) {
    var value = S.data && S.data[name];
    return Array.isArray(value) ? value : [];
  }

  function eventList() {
    return listOf('events');
  }

  function ddlList() {
    return listOf('ddls');
  }

  function findEvent(id) {
    if (!id) return null;
    var list = eventList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function findDdl(id) {
    if (!id) return null;
    var list = ddlList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function occurrenceKeysOf(event) {
    var out = [];
    var i;
    if (Array.isArray(event.dateKeys)) {
      for (i = 0; i < event.dateKeys.length; i++) out.push(event.dateKeys[i]);
    }
    if (Array.isArray(event.occurrences)) {
      for (i = 0; i < event.occurrences.length; i++) {
        var occ = event.occurrences[i];
        if (typeof occ === 'string') out.push(occ);
        else if (occ && typeof occ === 'object') out.push(occ.dateKey || occ.date);
      }
    }
    if (typeof event.nextDateKey === 'string') out.push(event.nextDateKey);
    return out;
  }

  function eventOnKey(event, key) {
    if (!event || typeof event !== 'object') return false;
    if (event.hidden) return false;
    var known = occurrenceKeysOf(event);
    for (var i = 0; i < known.length; i++) {
      if (known[i] === key) return true;
    }
    var date = typeof event.date === 'string' && event.date ? event.date
      : (typeof event.start === 'string' ? event.start : '');
    var repeat = event.repeat !== 'once';
    if (date.length === 10) {
      if (!repeat) return date === key;
      date = date.slice(5);
    }
    if (date.length !== 5 || date.charAt(2) !== '-') return false;
    var lunarEvent = event.calendar === 'lunar' || typeof event.lunarMonth === 'number';
    if (lunarEvent) {
      var info = lunarOf(key);
      if (!info || typeof info.month !== 'number' || typeof info.day !== 'number') return false;
      return info.month === parseInt(event.lunarMonth, 10) &&
        info.day === parseInt(event.lunarDay, 10) &&
        (!!info.leap) === (!!event.lunarLeap);
    }
    return date === key.slice(5);
  }

  function eventsOn(key) {
    var list = eventList();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (eventOnKey(list[i], key)) out.push(list[i]);
    }
    out.sort(function (a, b) {
      var rank = function (item) {
        if (!item) return 9;
        if (item.type === 'anniversary') return 0;
        if (item.type === 'birthday') return 1;
        return 5;
      };
      return rank(a) - rank(b);
    });
    return out;
  }

  function ddlsOn(key) {
    var list = ddlList();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].date === key) out.push(list[i]);
    }
    out.sort(function (a, b) {
      var da = a && a.done ? 1 : 0;
      var db = b && b.done ? 1 : 0;
      if (da !== db) return da - db;
      var ta = (a && a.time) || '99:99';
      var tb = (b && b.time) || '99:99';
      if (ta === tb) return 0;
      return ta < tb ? -1 : 1;
    });
    return out;
  }

  function unfinishedDdlCount(key) {
    var list = ddlList();
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && !list[i].done && list[i].date === key) n++;
    }
    return n;
  }

  function overdueDdls() {
    var today = todayKey();
    var list = ddlList();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var ddl = list[i];
      if (ddl && !ddl.done && isKey(ddl.date) && ddl.date < today) out.push(ddl);
    }
    out.sort(function (a, b) {
      if (a.date === b.date) return 0;
      return a.date < b.date ? -1 : 1;
    });
    return out;
  }

  function eventAnchorDate(event) {
    if (!event || typeof event !== 'object') return '';
    if (isKey(event.anchorDate)) return event.anchorDate;
    if (isKey(event.startDate)) return event.startDate;
    if (typeof event.date === 'string' && isKey(event.date)) return event.date;
    if (typeof event.start === 'string' && isKey(event.start)) return event.start;
    return '';
  }

  function anchorList() {
    var out = [];
    var seen = {};
    var groups = [listOf('anchors'), eventList()];
    for (var g = 0; g < groups.length; g++) {
      var list = groups[g];
      for (var i = 0; i < list.length; i++) {
        var event = list[i];
        if (!event || event.hidden) continue;
        if (event.type === 'festival') continue;
        var anchor = eventAnchorDate(event);
        if (!anchor) continue;
        if (event.type !== 'anniversary' && event.type !== 'birthday' &&
          !isKey(event.anchorDate) && !isKey(event.startDate) && !isKey(event.start)) continue;
        var memo = (event.id || event.title || '') + '@' + anchor;
        if (seen[memo]) continue;
        seen[memo] = true;
        out.push(event);
      }
    }
    return out;
  }

  function eventColorCss(event) {
    var color = event && event.color ? String(event.color) : '';
    if (color === 'rose' || color === 'red' || color === 'pink') {
      return 'var(--dsw-alias-state-error-primary,#e5484d)';
    }
    if (color === 'gold' || color === 'amber' || color === 'yellow' || color === 'orange') {
      return 'var(--dsw-alias-state-warn-primary,#b26a00)';
    }
    if (color === 'green' || color === 'teal') {
      return 'var(--dsw-alias-state-success-primary,#1f9d55)';
    }
    if (color === 'blue' || color === 'indigo' || color === 'violet') {
      return 'var(--dsw-alias-state-business-primary,#4d6bfe)';
    }
    return 'var(--dsw-alias-brand-primary,#4d6bfe)';
  }

  function hasEventTitle(list, fragment) {
    for (var i = 0; i < list.length; i++) {
      var title = list[i] && list[i].title ? String(list[i].title) : '';
      if (title.indexOf(fragment) >= 0) return true;
    }
    return false;
  }

  /* 某天由锚点派生出来的「第 N 天 / N 周年」（不存库，前端算） */
  function derivedOn(key, knownEvents) {
    var out = [];
    var anchors = anchorList();
    var existing = knownEvents || eventsOn(key);
    var kd = parseKey(key);
    if (!kd) return out;
    for (var i = 0; i < anchors.length; i++) {
      var event = anchors[i];
      var anchorKey = eventAnchorDate(event);
      var base = parseKey(anchorKey);
      if (!base) continue;
      var isBirthday = event.type === 'birthday';
      var diff = diffKey(anchorKey, key);
      /* 生日只看周岁，不算「第 100 天」 */
      if (!isBirthday && diff > 0 && diff <= 1000 && diff % 100 === 0) {
        var dayTag = '第 ' + diff + ' 天';
        if (!hasEventTitle(existing, dayTag)) {
          out.push({
            kind: 'days', event: event, days: diff, dateKey: key,
            title: event.title || '纪念日', tag: dayTag
          });
        }
      }
      if (kd.getMonth() === base.getMonth() && kd.getDate() === base.getDate()) {
        var years = kd.getFullYear() - base.getFullYear();
        if (years >= 1) {
          var yearTag = isBirthday ? years + ' 岁生日' : years + ' 周年';
          if (!hasEventTitle(existing, yearTag)) {
            out.push({
              kind: 'year', event: event, years: years, dateKey: key,
              title: event.title || '纪念日', tag: yearTag
            });
          }
        }
      }
    }
    return out;
  }

  function msTitle(event, row) {
    var base = event && event.title ? String(event.title) : '纪念日';
    return base + ' ' + (row.kind === 'year' ? row.years + ' 周年' : '第 ' + row.days + ' 天');
  }

  function milestoneRows(event) {
    var rows = [];
    var anchorKey = eventAnchorDate(event);
    var base = parseKey(anchorKey);
    if (!base) return rows;
    /* 与宿主一致：生日/节日不算「第 N 天」里程碑，显式关掉里程碑的事件也不列 */
    if (event.type === 'birthday' || event.type === 'festival') return rows;
    if (event.milestones === false) return rows;
    var today = parseKey(todayKey());
    for (var day = 100; day <= 1000; day += 100) {
      rows.push({
        kind: 'days', event: event, days: day, dateKey: keyOfDate(addDays(base, day)),
        title: event.title || '纪念日', tag: '第 ' + day + ' 天'
      });
    }
    var yearsPassed = 0;
    while (yearsPassed < 100 && dayDiff(addYears(base, yearsPassed + 1), today) <= 0) {
      yearsPassed++;
    }
    var startYear = yearsPassed > 0 ? yearsPassed : 1;
    for (var n = startYear; n <= startYear + 3; n++) {
      rows.push({
        kind: 'year', event: event, years: n, dateKey: keyOfDate(addYears(base, n)),
        title: event.title || '纪念日', tag: n + ' 周年'
      });
    }
    rows.sort(function (a, b) {
      if (a.dateKey === b.dateKey) return a.kind === 'days' ? -1 : 1;
      return a.dateKey < b.dateKey ? -1 : 1;
    });
    return rows;
  }

  function eventExistsOn(key, title) {
    var list = eventList();
    for (var i = 0; i < list.length; i++) {
      var event = list[i];
      if (!event) continue;
      if (!eventOnKey(event, key)) continue;
      if (String(event.title || '') === String(title || '')) return true;
    }
    return false;
  }

  function eventTypeTag(event) {
    if (!event) return '';
    if (event.type === 'anniversary') return '纪念日';
    if (event.type === 'birthday') return '生日';
    if (event.type === 'festival') return '节日';
    return '';
  }

  /* 某天的所有「事情」：事件、派生里程碑、节日、未完成 DDL */
  function itemsOn(key) {
    var out = [];
    var i;
    var events = eventsOn(key);
    for (i = 0; i < events.length; i++) {
      out.push({ kind: 'event', title: events[i].title || '事件', tag: eventTypeTag(events[i]) });
    }
    var derived = derivedOn(key, events);
    for (i = 0; i < derived.length; i++) {
      out.push({ kind: 'milestone', title: derived[i].title, tag: derived[i].tag });
    }
    var festivals = festivalsOf(key);
    for (i = 0; i < festivals.length; i++) {
      out.push({ kind: 'festival', title: festivals[i], tag: '节日' });
    }
    var ddls = ddlsOn(key);
    var shown = 0;
    for (i = 0; i < ddls.length; i++) {
      if (ddls[i].done) continue;
      if (shown >= 3) break;
      shown++;
      out.push({ kind: 'ddl', title: ddls[i].title || 'DDL', tag: ddls[i].time || 'DDL' });
    }
    return out;
  }

  function upcomingGroups() {
    var out = [];
    var indexOfKey = {};
    var base = parseKey(todayKey());
    var i;
    for (i = 0; i <= 30; i++) {
      var key = keyOfDate(addDays(base, i));
      var items = itemsOn(key);
      if (!items.length) continue;
      out.push({ key: key, days: i, items: items });
      indexOfKey[key] = out.length - 1;
    }
    var hostList = S.data && S.data.upcoming;
    if (Array.isArray(hostList)) {
      for (i = 0; i < hostList.length; i++) {
        var occ = hostList[i];
        if (!occ || !isKey(occ.dateKey)) continue;
        var days = diffKey(todayKey(), occ.dateKey);
        if (days < 0 || days > 30) continue;
        var title = String(occ.title || occ.kind || '事件');
        var slot = indexOfKey[occ.dateKey];
        var group = typeof slot === 'number' ? out[slot] : null;
        if (!group) {
          group = { key: occ.dateKey, days: days, items: [] };
          out.push(group);
          indexOfKey[occ.dateKey] = out.length - 1;
        }
        var duplicate = false;
        for (var j = 0; j < group.items.length; j++) {
          if (group.items[j].title === title) { duplicate = true; break; }
        }
        if (!duplicate) {
          var kind = occ.kind === 'milestone' ? 'milestone' : (occ.kind === 'festival' ? 'festival' : 'event');
          group.items.push({ kind: kind, title: title, tag: occ.lunarText || '' });
        }
      }
    }
    out.sort(function (a, b) { return a.days - b.days; });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 5. 视图 / 日期区间 / 形态                                            */
  /* ------------------------------------------------------------------ */

  function currentView() {
    if (!S.entry) {
      var now = new Date();
      S.entry = { y: now.getFullYear(), m: now.getMonth() + 1 };
    }
    return S.entry;
  }

  function gridRange() {
    var view = currentView();
    var first = new Date(view.y, view.m - 1, 1);
    var offset = (first.getDay() + 6) % 7; /* 周一为首 */
    var start = addDays(first, -offset);
    return { start: start, end: addDays(start, 41) };
  }

  /* 从真实 DOM 判断当前宿主形态：整页 .calc-page / 浮卡 .calc-coach-host */
  function domMode() {
    try {
      if (S.pane && connected(S.pane) && typeof S.pane.closest === 'function') {
        if (S.pane.closest('.calc-page')) return 'page';
        if (S.pane.closest('.calc-coach-host')) return 'card';
      }
    } catch (err) { /* ignore */ }
    return '';
  }

  function currentMode() {
    /* 宿主换了容器（整页 / 浮卡）时以 DOM 实际位置为准，避免文案不更新；
       同一次点击刚切完、宿主还没搬走时仍以 S.mode 为准，不然文案会跳回去 */
    var dom = domMode();
    if (dom && dom !== S.domMode) {
      S.domMode = dom;
      S.mode = dom;
    }
    if (S.mode === 'card' || S.mode === 'page') return S.mode;
    var width = 0;
    try {
      if (S.pane && S.pane.clientWidth) width = S.pane.clientWidth;
      else if (S.root && S.root.clientWidth) width = S.root.clientWidth;
    } catch (err) { width = 0; }
    return width > 560 ? 'page' : 'card';
  }

  function setMode(mode) {
    if (mode !== 'card' && mode !== 'page') return;
    S.mode = mode;
    paintToolbar();
  }

  function toggleMode() {
    var next = currentMode() === 'page' ? 'card' : 'page';
    var coach = S.coach;
    var handler = coach && coach.opts && typeof coach.opts.onToggleMode === 'function'
      ? coach.opts.onToggleMode : null;
    try {
      if (handler) handler(next);
      else if (coach && typeof coach.setMode === 'function') coach.setMode(next);
      else { flash('切换形态不可用', 'error'); return; }
      S.mode = next;
      paintToolbar();
    } catch (err) {
      flash('切换失败，请稍后重试', 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 6. 骨架 / 样式 / 事件绑定                                           */
  /* ------------------------------------------------------------------ */

  var CSS = [
    '.calc-root{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary,#191919);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.55;text-align:left;padding:6px 2px 20px}',
    '.calc-root *{box-sizing:border-box}',
    '.calc-root [hidden],.calc-rem-layer[hidden]{display:none!important}',

    '.calc-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0 10px}',
    '.calc-nav{display:flex;align-items:center;gap:2px}',
    '.calc-month{min-width:108px;text-align:center;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.01em}',
    '.calc-icon{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#5f6368);cursor:pointer;width:26px;height:26px;border-radius:8px;font-family:inherit;font-size:16px;font-weight:600;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}',
    '.calc-icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#191919)}',
    '.calc-btn{appearance:none;font-family:inherit;font-size:12px;font-weight:500;line-height:1.2;color:var(--dsw-alias-label-secondary,#5f6368);background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:8px;padding:5px 10px;cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease}',
    '.calc-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#191919)}',
    '.calc-btn:disabled{opacity:.55;cursor:default}',
    '.calc-btn.is-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.calc-btn.is-primary:hover{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);opacity:.92}',
    '.calc-btn.is-danger{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:var(--dsw-alias-state-error-primary,#e5484d)}',
    '.calc-btn.is-mini{font-size:11px;padding:3px 8px;border-radius:7px}',
    '.calc-spring{flex:1 1 auto}',

    '.calc-msg{margin:0 0 8px;padding:6px 9px;border-radius:8px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5f6368);background:var(--dsw-alias-bg-layer-2,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}',
    '.calc-msg.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);border-color:var(--dsw-alias-state-success-primary,#1f9d55)}',
    '.calc-msg.is-error{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:var(--dsw-alias-state-error-primary,#e5484d)}',
    '.calc-msg.is-muted{color:var(--dsw-alias-label-tertiary,#8a8f98)}',

    '.calc-weekhead{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-bottom:4px}',
    '.calc-weekday{text-align:center;font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--dsw-alias-label-tertiary,#8a8f98);padding:2px 0}',
    '.calc-weekday.is-weekend{color:var(--dsw-alias-state-warn-primary,#b26a00)}',

    '.calc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-bottom:2px}',
    '.calc-cell{appearance:none;position:relative;display:flex;flex-direction:column;align-items:stretch;gap:1px;min-height:62px;padding:4px 4px 3px;border:1px solid transparent;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f5f6f8);color:inherit;font-family:inherit;font-size:12px;text-align:left;cursor:pointer;transition:background .12s ease,border-color .12s ease}',
    '.calc-cell:hover{background:var(--dsw-alias-bg-layer-3,#eef0f3)}',
    '.calc-cell.is-other{opacity:.42}',
    '.calc-cell.is-selected{box-shadow:inset 0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}',
    '.calc-cell.is-today{background:var(--dsw-alias-bg-layer-3,#eef0f3);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
    '.calc-cell.is-today .calc-num{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:800}',
    '.calc-cell-top{display:flex;align-items:center;gap:2px;min-height:17px}',
    '.calc-num{display:inline-block;min-width:17px;text-align:center;font-size:12px;font-weight:600;line-height:17px;font-variant-numeric:tabular-nums;border-radius:6px}',
    '.calc-cell.is-today .calc-num{background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 3px}',
    '.calc-badge{margin-left:auto;min-width:14px;padding:0 4px;border-radius:99px;font-size:9.5px;font-weight:700;line-height:14px;text-align:center;background:var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.calc-lunar{font-size:9.5px;line-height:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.calc-lunar.is-festival{color:var(--dsw-alias-state-warn-primary,#b26a00);font-weight:600}',
    '.calc-dots{display:flex;align-items:center;gap:2px;margin-top:auto;min-height:6px;flex-wrap:wrap}',
    '.calc-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe);flex:none}',
    '.calc-dot.is-gold{background:var(--dsw-alias-state-warn-primary,#b26a00)}',
    '.calc-dot.is-festival{background:var(--dsw-alias-state-warn-primary,#b26a00)}',
    '.calc-dot-more{font-size:8.5px;line-height:1;color:var(--dsw-alias-label-tertiary,#8a8f98)}',

    '.calc-section{margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}',
    '.calc-sec-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}',
    '.calc-sec-title{font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
    '.calc-sec-hint{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
    '.calc-hint{margin:2px 0 10px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#8a8f98)}',

    '.calc-detail{background:var(--dsw-alias-bg-layer-2,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:12px;padding:12px 13px}',
    '.calc-day-head{padding-bottom:8px}',
    '.calc-day-main{font-size:15px;font-weight:600;line-height:1.35}',
    '.calc-day-sub{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#5f6368)}',
    '.calc-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
    '.calc-chip{display:inline-flex;align-items:center;padding:1px 7px;border-radius:99px;font-size:10px;line-height:16px;background:var(--dsw-alias-bg-layer-3,#eef0f3);color:var(--dsw-alias-label-secondary,#5f6368);white-space:nowrap}',
    '.calc-chip.is-gold{color:var(--dsw-alias-state-warn-primary,#b26a00);background:var(--dsw-alias-state-warn-tertiary,rgba(245,166,35,.16))}',
    '.calc-chip.is-danger{color:var(--dsw-alias-state-error-primary,#e5484d);background:var(--dsw-alias-state-error-tertiary,rgba(229,72,77,.12))}',

    '.calc-sub-title{display:flex;align-items:baseline;gap:6px;margin:10px 0 4px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6368)}',
    '.calc-sub-count{font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
    '.calc-rows{display:flex;flex-direction:column;gap:1px}',
    '.calc-row{display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:8px;min-width:0}',
    '.calc-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
    '.calc-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.calc-row-title{font-size:12.5px;font-weight:500;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.calc-tags{display:flex;flex-wrap:wrap;gap:4px}',
    '.calc-empty{padding:8px 2px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a8f98)}',

    '.calc-ddl.is-done .calc-row-title{color:var(--dsw-alias-label-tertiary,#8a8f98);text-decoration:line-through;text-decoration-color:var(--dsw-alias-label-tertiary,#8a8f98)}',
    '.calc-check{appearance:none;flex:none;width:15px;height:15px;border:1.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.28));border-radius:4.5px;background:transparent;cursor:pointer;position:relative;padding:0;margin:0}',
    '.calc-check:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
    '.calc-ddl.is-done .calc-check{background:var(--dsw-alias-state-success-primary,#1f9d55);border-color:var(--dsw-alias-state-success-primary,#1f9d55)}',
    '.calc-ddl.is-done .calc-check::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid var(--dsw-alias-label-primary-foreground,#fff);border-width:0 2px 2px 0;transform:rotate(42deg)}',
    '.calc-x{appearance:none;flex:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);font-family:inherit;font-size:10.5px;line-height:1;padding:3px 5px;border-radius:6px;cursor:pointer}',
    '.calc-x:hover{color:var(--dsw-alias-state-error-primary,#e5484d);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
    '.calc-confirm{flex:none;font-size:10.5px;color:var(--dsw-alias-state-error-primary,#e5484d);margin-left:auto;padding-right:2px}',
    '.calc-x.is-ghost{color:var(--dsw-alias-label-tertiary,#8a8f98)}',
    '.calc-x.is-ghost:hover{color:var(--dsw-alias-label-secondary,#5c6169);background:transparent}',
    '.calc-add{display:flex;gap:6px;align-items:center;margin-top:8px}',
    '.calc-add .calc-input{flex:1 1 auto;min-width:0}',
    '.calc-input{font-family:inherit;font-size:12px;line-height:1.3;color:var(--dsw-alias-label-primary,#191919);background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:8px;padding:5px 8px;outline:none;min-width:0}',
    '.calc-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
    '.calc-input::placeholder{color:var(--dsw-alias-label-tertiary,#8a8f98)}',
    '.calc-select{padding:4px 6px}',

    '.calc-list{display:flex;flex-direction:column;gap:3px}',
    '.calc-up{appearance:none;display:flex;align-items:center;gap:9px;width:100%;text-align:left;font-family:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2,#f5f6f8);border:1px solid transparent;border-radius:10px;padding:7px 9px;cursor:pointer}',
    '.calc-up:hover{background:var(--dsw-alias-bg-layer-3,#eef0f3)}',
    '.calc-up-when{flex:none;display:flex;flex-direction:column;align-items:flex-start;min-width:58px}',
    '.calc-up-when b{font-size:12px;font-weight:600;color:var(--dsw-alias-state-warn-primary,#b26a00);line-height:1.3;white-space:nowrap}',
    '.calc-up-when em{font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.3;white-space:nowrap}',
    '.calc-up-main{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;gap:3px 8px;align-items:center}',
    '.calc-up-item{display:inline-flex;align-items:center;gap:5px;min-width:0}',
    '.calc-up-title{font-size:12.5px;line-height:1.4;color:var(--dsw-alias-label-primary,#191919);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
    '.calc-up-lunar{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8f98);max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

    '.calc-ms-group{margin-bottom:10px}',
    '.calc-ms-head{display:flex;align-items:baseline;gap:8px;padding:4px 2px 5px}',
    '.calc-ms-head b{font-size:12.5px;font-weight:600}',
    '.calc-ms-anchor{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums}',
    '.calc-ms{background:transparent}',
    '.calc-ms:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
    '.calc-ms-date{appearance:none;flex:none;font-family:inherit;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6368);background:var(--dsw-alias-bg-layer-2,#f5f6f8);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:7px;padding:2px 6px;cursor:pointer;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.calc-ms-date:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
    '.calc-rel{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap}',
    '.calc-rel.is-today{color:var(--dsw-alias-state-error-primary,#e5484d);font-weight:600}',

    '.calc-modal{position:fixed;inset:0;z-index:2147482800;display:flex;align-items:center;justify-content:center;padding:16px}',
    '.calc-modal-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.42))}',
    '.calc-modal-card{position:relative;width:min(420px,100%);max-height:calc(100vh - 40px);overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#191919);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:14px;padding:14px 16px 12px;box-shadow:0 24px 64px color-mix(in srgb, var(--dsw-alias-label-primary,#191919) 26%, transparent)}',
    '.calc-modal-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
    '.calc-modal-head b{font-size:14px;font-weight:600}',
    '.calc-modal-head .calc-icon{margin-left:auto}',
    '.calc-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}',
    '.calc-field-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6368)}',
    '.calc-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:9px;overflow:hidden;align-self:flex-start}',
    '.calc-seg-btn{appearance:none;font-family:inherit;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,#5f6368);background:transparent;border:0;padding:5px 16px;cursor:pointer}',
    '.calc-seg-btn+.calc-seg-btn{border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14))}',
    '.calc-seg-btn.is-on{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.calc-inline{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.calc-check-line{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#5f6368);cursor:pointer;white-space:nowrap}',
    '.calc-check-line input[type="checkbox"]{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);margin:0}',
    '.calc-leads{display:flex;flex-wrap:wrap;gap:6px 14px}',
    '.calc-modal-actions{display:flex;align-items:center;gap:8px;margin-top:12px}',

    '.calc-rem-layer{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483000;width:min(560px,calc(100vw - 28px));display:flex;flex-direction:column;gap:8px;align-items:stretch;pointer-events:none}',
    '.calc-rem{pointer-events:auto;position:relative;overflow:hidden;border-radius:16px;padding:18px 18px 14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#191919);border:1px solid var(--dsw-alias-state-warn-primary,#b26a00);box-shadow:0 20px 60px color-mix(in srgb, var(--dsw-alias-label-primary,#191919) 30%, transparent),0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary,#191919) 6%, transparent);animation:calc-rem-in .3s cubic-bezier(.2,.9,.3,1.08) both}',
    '.calc-rem::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,var(--dsw-alias-state-error-primary,#e5484d),var(--dsw-alias-state-warn-primary,#b26a00),var(--dsw-alias-state-error-primary,#e5484d))}',
    '.calc-rem.is-important{border-color:var(--dsw-alias-state-error-primary,#e5484d);animation:calc-rem-in .3s cubic-bezier(.2,.9,.3,1.08) both,calc-rem-pulse 1.5s ease-in-out 2.2s 3}',
    '.calc-rem-top{display:flex;align-items:center;gap:6px}',
    '.calc-rem-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.12em;white-space:nowrap;color:var(--dsw-alias-state-warn-primary,#b26a00);border:1px solid var(--dsw-alias-state-warn-primary,#b26a00)}',
    '.calc-rem.is-important .calc-rem-badge{color:var(--dsw-alias-state-error-primary,#e5484d);border-color:var(--dsw-alias-state-error-primary,#e5484d)}',
    '.calc-rem-x{appearance:none;margin-left:auto;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);font-family:inherit;font-size:15px;line-height:1;padding:2px 5px;border-radius:6px;cursor:pointer}',
    '.calc-rem-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#191919)}',
    '.calc-rem-x+.calc-rem-x{margin-left:0}',
    '.calc-rem-title{margin-top:6px;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:.01em;word-break:break-word}',
    '.calc-rem-sub{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.calc-rem-chip{display:inline-flex;align-items:center;padding:1px 8px;border-radius:99px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#5f6368);background:var(--dsw-alias-bg-layer-3,#eef0f3);white-space:nowrap}',
    '.calc-rem-body{margin-top:8px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#5f6368);white-space:pre-wrap;word-break:break-word;max-height:96px;overflow:auto}',
    '.calc-rem-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}',
    '.calc-rem-btn{appearance:none;font-family:inherit;font-size:12.5px;font-weight:600;line-height:1.2;padding:7px 14px;border-radius:9px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));background:transparent;color:var(--dsw-alias-label-primary,#191919)}',
    '.calc-rem-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}',
    '.calc-rem-btn.is-primary{background:var(--dsw-alias-state-error-primary,#e5484d);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.calc-rem-btn.is-primary:hover{opacity:.92;background:var(--dsw-alias-state-error-primary,#e5484d);color:var(--dsw-alias-label-primary-foreground,#fff)}',
    '.calc-rem-btn.is-ghost{color:var(--dsw-alias-label-secondary,#5f6368)}',

    '@keyframes calc-rem-in{from{opacity:0;transform:translateY(-16px) scale(.97)}to{opacity:1;transform:none}}',
    '@keyframes calc-rem-pulse{0%,100%{box-shadow:0 20px 60px color-mix(in srgb, var(--dsw-alias-label-primary,#191919) 30%, transparent),0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-error-primary,#e5484d) 45%, transparent)}50%{box-shadow:0 20px 60px color-mix(in srgb, var(--dsw-alias-label-primary,#191919) 30%, transparent),0 0 0 14px color-mix(in srgb, var(--dsw-alias-state-error-primary,#e5484d) 0%, transparent)}}',

    '.calc-btn:focus-visible,.calc-icon:focus-visible,.calc-cell:focus-visible,.calc-up:focus-visible,.calc-check:focus-visible,.calc-ms-date:focus-visible,.calc-rem-btn:focus-visible,.calc-rem-x:focus-visible,.calc-input:focus-visible,.calc-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',

    '@media (max-width:560px){.calc-cell{min-height:52px;border-radius:8px;padding:3px 3px 2px}.calc-lunar{font-size:9px}.calc-month{min-width:92px;font-size:14px}.calc-toolbar{gap:4px}.calc-up-lunar{display:none}.calc-rem-title{font-size:20px}}',
    '@media (max-width:380px){.calc-cell{min-height:46px}.calc-lunar{font-size:8px}.calc-badge{font-size:8.5px;line-height:12px;min-width:12px}.calc-up-when{min-width:50px}.calc-btn{padding:4px 7px}}',
    /* 浮卡里日历不是按视口变窄，而是按容器变窄：由 JS 打 is-compact / is-narrow */
    '.calc-root.is-compact .calc-cell{min-height:52px;border-radius:8px;padding:3px 3px 2px}',
    '.calc-root.is-compact .calc-lunar{font-size:9px}',
    '.calc-root.is-compact .calc-month{min-width:92px;font-size:14px}',
    '.calc-root.is-compact .calc-toolbar{gap:4px}',
    '.calc-root.is-compact .calc-up-lunar{display:none}',
    '.calc-root.is-compact .calc-sec-hint{display:none}',
    '.calc-root.is-narrow .calc-cell{min-height:46px}',
    '.calc-root.is-narrow .calc-lunar{font-size:8px}',
    '.calc-root.is-narrow .calc-badge{font-size:8.5px;line-height:12px;min-width:12px}',
    '.calc-root.is-narrow .calc-up-when{min-width:50px}',
    '.calc-root.is-narrow .calc-btn{padding:4px 7px}',
    '.calc-root.is-narrow .calc-month{min-width:84px;font-size:13px}',
    '@media (prefers-reduced-motion:reduce){.calc-rem,.calc-rem.is-important{animation:none}.calc-cell,.calc-btn,.calc-row,.calc-up{transition:none}}'
  ].join('\n');

  function injectStyles(host) {
    if (!host || !host.querySelector) return;
    for (var i = 0; i < S.styles.length; i++) {
      if (S.styles[i] && S.styles[i].parentNode === host) return;
    }
    try {
      if (host.querySelector('style[data-calc-style]')) return;
      var style = el('style');
      style.setAttribute('data-calc-style', '1');
      style.textContent = CSS;
      host.insertBefore(style, host.firstChild || null);
      S.styles.push(style);
    } catch (err) { /* 样式注入失败不致命 */ }
  }

  function skeletonHtml() {
    var weekhead = '';
    for (var i = 0; i < WEEK_LABELS.length; i++) {
      weekhead += '<span class="calc-weekday' + (i >= 5 ? ' is-weekend' : '') + '">' + WEEK_LABELS[i] + '</span>';
    }
    var lunarMonths = '';
    for (var m = 1; m <= 12; m++) {
      lunarMonths += '<option value="' + m + '">' + lunarMonthLabel(m, false) + '</option>';
    }
    var lunarDays = '';
    for (var d = 1; d <= 30; d++) {
      lunarDays += '<option value="' + d + '">' + lunarDayLabel(d) + '</option>';
    }
    return [
      '<div class="calc-toolbar">',
      '<div class="calc-nav">',
      '<button type="button" class="calc-icon" data-act="prev-month" aria-label="上个月" title="上个月">\u2039</button>',
      '<span class="calc-month" data-ref="month"></span>',
      '<button type="button" class="calc-icon" data-act="next-month" aria-label="下个月" title="下个月">\u203A</button>',
      '</div>',
      '<button type="button" class="calc-btn" data-act="today">回到今天</button>',
      '<span class="calc-spring"></span>',
      '<button type="button" class="calc-btn is-primary" data-act="new-event">+ 事件</button>',
      '<button type="button" class="calc-btn" data-act="new-ddl">+ DDL</button>',
      '<button type="button" class="calc-btn" data-act="toggle-mode" data-ref="modeBtn" title="切换浮卡 / 整页">展开整页</button>',
      '</div>',
      '<div class="calc-msg is-muted" data-ref="loading" hidden>正在同步…</div>',
      '<div class="calc-msg" data-ref="flash" hidden></div>',
      '<div class="calc-msg is-error" data-ref="error" hidden></div>',
      '<div class="calc-weekhead">' + weekhead + '</div>',
      '<div class="calc-grid" data-ref="grid" role="grid" aria-label="月视图"></div>',
      '<section class="calc-section">',
      '<div class="calc-sec-head"><span class="calc-sec-title">当天</span><span class="calc-sec-hint" data-ref="detailHint"></span></div>',
      '<div class="calc-detail" data-ref="detail"></div>',
      '</section>',
      '<section class="calc-section">',
      '<div class="calc-sec-head"><span class="calc-sec-title">未来 30 天</span><span class="calc-sec-hint">倒计时</span></div>',
      '<div class="calc-list" data-ref="upcoming"></div>',
      '</section>',
      '<section class="calc-section">',
      '<div class="calc-sec-head"><span class="calc-sec-title">里程碑</span><span class="calc-sec-hint">100 天 / 周年</span></div>',
      '<div class="calc-list" data-ref="milestones"></div>',
      '</section>',
      '<div class="calc-modal" data-ref="modal" hidden>',
      '<div class="calc-modal-mask" data-act="modal-close"></div>',
      '<div class="calc-modal-card" role="dialog" aria-modal="true" aria-label="事件表单">',
      '<div class="calc-modal-head"><b data-ref="formTitle">新增事件</b>',
      '<button type="button" class="calc-icon" data-act="modal-close" aria-label="关闭">\u00D7</button></div>',
      '<label class="calc-field"><span class="calc-field-label">标题</span>',
      '<input class="calc-input" data-ref="fTitle" type="text" maxlength="40" placeholder="例如：恋爱纪念日"></label>',
      '<div class="calc-field"><span class="calc-field-label">历法</span>',
      '<div class="calc-seg" data-ref="fCal">',
      '<button type="button" class="calc-seg-btn is-on" data-act="f-cal" data-val="solar">公历</button>',
      '<button type="button" class="calc-seg-btn" data-act="f-cal" data-val="lunar">农历</button>',
      '</div></div>',
      '<div class="calc-field" data-ref="fSolarWrap"><span class="calc-field-label">公历日期</span>',
      '<input class="calc-input" data-ref="fDate" type="date"></div>',
      '<div class="calc-field" data-ref="fLunarWrap" hidden><span class="calc-field-label">农历日期</span>',
      '<div class="calc-inline">',
      '<select class="calc-input calc-select" data-ref="fLMonth" aria-label="农历月">' + lunarMonths + '</select>',
      '<select class="calc-input calc-select" data-ref="fLDay" aria-label="农历日">' + lunarDays + '</select>',
      '<label class="calc-check-line"><input type="checkbox" data-ref="fLeap"> 闰月</label>',
      '</div></div>',
      '<div class="calc-hint" data-ref="fLunarHint" hidden>每年按农历换算；上面的「公历起始日」只用来算第几天和几岁。</div>',
      '<label class="calc-check-line" style="margin-bottom:10px"><input type="checkbox" data-ref="fRepeat" checked> 每年重复</label>',
      '<div class="calc-field"><span class="calc-field-label">提前提醒</span><div class="calc-leads" data-ref="fLeads">',
      '<label class="calc-check-line"><input type="checkbox" data-lead="7" checked> 7 天前</label>',
      '<label class="calc-check-line"><input type="checkbox" data-lead="3"> 3 天前</label>',
      '<label class="calc-check-line"><input type="checkbox" data-lead="1" checked> 1 天前</label>',
      '<label class="calc-check-line"><input type="checkbox" data-lead="0" checked> 当天</label>',
      '</div></div>',
      '<label class="calc-field"><span class="calc-field-label">提醒时间</span>',
      '<input class="calc-input" data-ref="fTime" type="time" value="09:00"></label>',
      '<div class="calc-msg" data-ref="fMsg" hidden></div>',
      '<div class="calc-modal-actions">',
      '<button type="button" class="calc-btn is-danger" data-act="form-delete" data-ref="fDelete" hidden>删除</button>',
      '<span class="calc-spring"></span>',
      '<button type="button" class="calc-btn" data-act="modal-close">取消</button>',
      '<button type="button" class="calc-btn is-primary" data-act="form-save" data-ref="fSave">保存</button>',
      '</div>',
      '</div></div>'
    ].join('');
  }

  function collectRefs(root) {
    var out = {};
    var nodes = root.querySelectorAll('[data-ref]');
    for (var i = 0; i < nodes.length; i++) {
      out[nodes[i].getAttribute('data-ref')] = nodes[i];
    }
    return out;
  }

  function ensureRoot(host) {
    if (!host) return false;
    injectStyles(host);
    if (S.root && connected(S.root) && S.root.parentNode === host) return true;
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    var root = el('div', 'calc-root');
    root.setAttribute('data-calc-root', '1');
    root.innerHTML = skeletonHtml();
    host.appendChild(root);
    S.root = root;
    S.compact = null;
    S.narrow = null;
    S.els = collectRefs(root);
    S.focusDdl = false;
    bindRoot(root);
    return true;
  }

  function bindRoot(root) {
    if (!root || S.bound) return;
    S.bound = true;
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('input', onInput);
  }

  /* ------------------------------------------------------------------ */
  /* 7. 绘制                                                             */
  /* ------------------------------------------------------------------ */

  function schedulePaint() {
    if (S.destroyed) return;
    if (S.paintTimer) return;
    S.paintTimer = setTimeout(function () {
      S.paintTimer = null;
      paint();
    }, 70);
  }

  function onViewportResize() {
    schedulePaint();
  }

  /* 浮卡里容器比视口窄得多，所以按容器宽度切紧凑样式 */
  function syncDensity() {
    if (!S.root) return;
    var width = 0;
    try {
      if (S.pane && connected(S.pane)) width = S.pane.clientWidth || 0;
      if (!width && S.root.clientWidth) width = S.root.clientWidth;
    } catch (err) { width = 0; }
    if (!width) return;
    var compact = width < 560;
    var narrow = width < 400;
    if (S.compact !== compact) {
      S.compact = compact;
      setFlag(S.root, 'is-compact', compact);
    }
    if (S.narrow !== narrow) {
      S.narrow = narrow;
      setFlag(S.root, 'is-narrow', narrow);
    }
  }

  function paint() {
    if (S.destroyed) return;
    if (S.root) {
      syncDensity();
      paintToolbar();
      paintFlash();
      paintLoading();
      paintError();
      paintGrid();
      paintDetail();
      paintUpcoming();
      paintMilestones();
      ensureLunarForVisible();
    }
    /* 提醒卡可能单独存在（卡片形态没有日历容器），所以不受 root 限制 */
    if (S.rem) renderReminderCard();
  }

  function paintToolbar() {
    if (!S.els) return;
    setText(S.els.month, fmtMonthTitle(currentView()));
    var modeBtn = S.els.modeBtn;
    if (modeBtn) {
      modeBtn.textContent = currentMode() === 'page' ? '收进浮卡' : '展开整页';
    }
  }

  function flash(message, kind) {
    if (!message) return;
    S.flash = { msg: message, kind: kind || '' };
    if (S.flashTimer) clearTimeout(S.flashTimer);
    S.flashTimer = setTimeout(function () {
      S.flashTimer = null;
      S.flash = null;
      paintFlash();
    }, 6000);
    paintFlash();
  }

  function paintFlash() {
    var node = S.els && S.els.flash;
    if (!node) return;
    if (!S.flash || !S.flash.msg) {
      node.hidden = true;
      node.textContent = '';
      node.className = 'calc-msg';
      return;
    }
    node.hidden = false;
    node.textContent = S.flash.msg;
    node.className = 'calc-msg' + (S.flash.kind ? ' is-' + S.flash.kind : '');
  }

  function paintLoading() {
    showEl(S.els && S.els.loading, !!S.loading);
  }

  function paintError() {
    var node = S.els && S.els.error;
    if (!node) return;
    if (!S.error) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.innerHTML = '<span>' + esc(S.error) + '</span> ' +
      '<button type="button" class="calc-btn is-mini" data-act="retry">重试</button>';
  }

  function paintGrid() {
    var grid = S.els && S.els.grid;
    if (!grid) return;
    var view = currentView();
    var range = gridRange();
    var today = todayKey();
    var html = '';
    for (var i = 0; i < 42; i++) {
      var date = addDays(range.start, i);
      var key = keyOfDate(date);
      var isOther = (date.getMonth() + 1) !== view.m;
      var info = lunarOf(key);
      var festivals = festivalsOf(key);
      var events = eventsOn(key);
      var derived = derivedOn(key, events);
      var dots = '';
      var dotCount = 0;
      for (var j = 0; j < events.length && dotCount < 3; j++) {
        dots += '<i class="calc-dot" style="background:' + eventColorCss(events[j]) + '"></i>';
        dotCount++;
      }
      if (derived.length && dotCount < 3) {
        dots += '<i class="calc-dot is-gold"></i>';
        dotCount++;
      }
      if (events.length > 3) {
        dots += '<span class="calc-dot-more">+' + (events.length - 3) + '</span>';
      }
      var ddlCount = unfinishedDdlCount(key);
      var cls = 'calc-cell';
      if (isOther) cls += ' is-other';
      if (key === today) cls += ' is-today';
      if (key === S.selected) cls += ' is-selected';
      var aria = fmtDateLong(date) + (lunarShort(key) ? ' ' + lunarShort(key) : '');
      html += '<button type="button" class="' + cls + '" data-act="day" data-key="' + key + '"' +
        ' role="gridcell" aria-label="' + esc(aria) + '">' +
        '<span class="calc-cell-top"><span class="calc-num">' + date.getDate() + '</span>' +
        (ddlCount ? '<span class="calc-badge">' + (ddlCount > 9 ? '9+' : ddlCount) + '</span>' : '') +
        '</span>' +
        '<span class="calc-lunar' + (festivals.length ? ' is-festival' : '') + '">' +
        esc(shortLunar(info)) + '</span>' +
        '<span class="calc-dots">' + dots + '</span>' +
        '</button>';
    }
    grid.innerHTML = html;
  }

  function eventRowHtml(event) {
    var tags = [];
    tags.push('<span class="calc-chip">' + esc(relShort(S.selected || todayKey())) + '</span>');
    var typeTag = eventTypeTag(event);
    if (typeTag) tags.push('<span class="calc-chip">' + esc(typeTag) + '</span>');
    if (event.calendar === 'lunar' || typeof event.lunarMonth === 'number') {
      tags.push('<span class="calc-chip">农历</span>');
    }
    if (event.repeat === 'yearly' || (typeof event.date === 'string' && event.date.length === 5)) {
      tags.push('<span class="calc-chip">每年</span>');
    }
    var html = '<div class="calc-row">' +
      '<i class="calc-dot" style="background:' + eventColorCss(event) + '"></i>' +
      '<div class="calc-row-main"><b class="calc-row-title">' + esc(event.title || '未命名事件') + '</b>' +
      '<span class="calc-tags">' + tags.join('') + '</span></div>';
    if (event.id) {
      html += '<button type="button" class="calc-x" data-act="event-edit" data-id="' + esc(event.id) + '" title="编辑事件">编辑</button>';
    }
    html += '</div>';
    return html;
  }

  function derivedRowHtml(item) {
    return '<div class="calc-row">' +
      '<i class="calc-dot is-gold"></i>' +
      '<div class="calc-row-main"><b class="calc-row-title">' + esc(item.title) + '</b>' +
      '<span class="calc-tags">' +
      '<span class="calc-chip is-gold">' + esc(item.tag) + '</span>' +
      '<span class="calc-chip">' + (item.kind === 'year' ? '周年' : '百天') + '</span>' +
      '</span></div></div>';
  }

  /* 删除确认做成"行内两段式"：第一次点变「确定删除？ 删除/取消」，
     状态画进 DOM 而不是只改按钮文字——这样任何一次重绘都不会把提示吞掉。
     6 秒没操作自动收回。 */
  function ddlActionsHtml(ddl) {
    var id = esc(ddl.id || '');
    if (S.confirm && S.confirm['ddl:' + ddl.id]) {
      return '<span class="calc-confirm">确定删除？</span>' +
        '<button type="button" class="calc-x" data-act="ddl-del-yes" data-id="' + id + '">删除</button>' +
        '<button type="button" class="calc-x is-ghost" data-act="ddl-del-cancel" data-id="' + id + '">取消</button>'
    }
    return '<button type="button" class="calc-x" data-act="ddl-del" data-id="' + id + '">删除</button>'
  }

  function ddlRowHtml(ddl, overdue) {
    var tags = [];
    if (ddl.time) tags.push('<span class="calc-chip">' + esc(ddl.time) + '</span>');
    if (ddl.priority === 'high') tags.push('<span class="calc-chip is-danger">重要</span>');
    if (overdue) tags.push('<span class="calc-chip is-danger">' + esc(relShort(ddl.date)) + '</span>');
    if (ddl.origin === 'ai') tags.push('<span class="calc-chip">AI</span>');
    return '<div class="calc-row calc-ddl' + (ddl.done ? ' is-done' : '') + '">' +
      '<button type="button" class="calc-check" data-act="ddl-toggle" data-id="' + esc(ddl.id || '') + '"' +
      ' aria-label="' + (ddl.done ? '标记未完成' : '标记完成') + '" aria-pressed="' + (ddl.done ? 'true' : 'false') + '"></button>' +
      '<div class="calc-row-main"><b class="calc-row-title">' + esc(ddl.title || 'DDL') + '</b>' +
      '<span class="calc-tags">' + tags.join('') + '</span></div>' +
      ddlActionsHtml(ddl) +
      '</div>';
  }

  function paintDetail() {
    var box = S.els && S.els.detail;
    if (!box) return;
    if (!S.selected || !isKey(S.selected)) S.selected = todayKey();
    var key = S.selected;
    var date = parseKey(key);
    var lunarText = lunarTextOf(key);
    var festivals = festivalsOf(key);
    var events = eventsOn(key);
    var derived = derivedOn(key, events);
    var ddls = ddlsOn(key);
    var doneCount = 0;
    var i;
    for (i = 0; i < ddls.length; i++) if (ddls[i].done) doneCount++;
    var isToday = key === todayKey();
    var overdue = isToday ? overdueDdls() : [];

    /* 保留输入框的焦点与光标，避免农历异步回填时把用户打字打断 */
    var active = document.activeElement;
    var keepFocus = false;
    var caret = 0;
    if (active && box.contains && box.contains(active) && active.getAttribute &&
      active.getAttribute('data-ref') === 'ddlInput') {
      keepFocus = true;
      try { caret = active.selectionStart || 0; } catch (err) { caret = 0; }
    }

    var html = '<div class="calc-day-head">' +
      '<div class="calc-day-main">' + esc(fmtDateLong(date)) + '</div>' +
      '<div class="calc-day-sub">' + esc(lunarText || '农历 —') + ' · ' + esc(relText(key)) + '</div>';
    if (festivals.length) {
      html += '<div class="calc-chips">';
      for (i = 0; i < festivals.length; i++) {
        html += '<span class="calc-chip is-gold">' + esc(festivals[i]) + '</span>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="calc-sub-title">事件 <span class="calc-sub-count">' + (events.length + derived.length) + '</span></div>';
    if (!events.length && !derived.length) {
      html += '<div class="calc-empty">这天没有事件。点上方「+ 事件」记一个。</div>';
    } else {
      html += '<div class="calc-rows">';
      for (i = 0; i < events.length; i++) html += eventRowHtml(events[i]);
      for (i = 0; i < derived.length; i++) html += derivedRowHtml(derived[i]);
      html += '</div>';
    }

    html += '<div class="calc-sub-title">DDL <span class="calc-sub-count">' + doneCount + '/' + ddls.length + '</span></div>';
    if (overdue.length) {
      html += '<div class="calc-sub-title" style="margin-top:2px"><span class="calc-sub-count">逾期未完成</span></div>';
      html += '<div class="calc-rows">';
      for (i = 0; i < overdue.length; i++) html += ddlRowHtml(overdue[i], true);
      html += '</div>';
    }
    if (!ddls.length) {
      html += '<div class="calc-empty">这天没有 DDL。</div>';
    } else {
      html += '<div class="calc-rows">';
      for (i = 0; i < ddls.length; i++) html += ddlRowHtml(ddls[i], false);
      html += '</div>';
    }
    html += '<div class="calc-add">' +
      '<input class="calc-input" data-ref="ddlInput" type="text" maxlength="60"' +
      ' placeholder="新增一条 DDL，回车保存" value="' + esc(S.ddlDraft) + '">' +
      '<button type="button" class="calc-btn is-primary is-mini" data-act="ddl-add">添加</button>' +
      '</div>';

    box.innerHTML = html;
    S.els.ddlInput = box.querySelector('[data-ref="ddlInput"]');
    if (keepFocus && S.els.ddlInput) {
      try {
        S.els.ddlInput.focus();
        S.els.ddlInput.setSelectionRange(caret, caret);
      } catch (err) { /* 忽略 */ }
    }
    if (S.focusDdl) {
      S.focusDdl = false;
      focusDdlInput();
    }
    var hint = S.els.detailHint;
    if (hint) hint.textContent = relText(key);
  }

  function paintUpcoming() {
    var box = S.els && S.els.upcoming;
    if (!box) return;
    var groups = upcomingGroups();
    if (!groups.length) {
      box.innerHTML = '<div class="calc-empty">未来 30 天没有纪念日、节日或 DDL。</div>';
      return;
    }
    var html = '';
    var rows = 0;
    var i;
    for (i = 0; i < groups.length && rows < MAX_UPCOMING_ROWS; i++) {
      var group = groups[i];
      var date = parseKey(group.key);
      html += '<button type="button" class="calc-up" data-act="day" data-key="' + group.key + '">' +
        '<span class="calc-up-when"><b>' + esc(group.days === 0 ? '今天' : '还有 ' + group.days + ' 天') + '</b>' +
        '<em>' + esc(fmtMonthDay(date)) + '</em></span>' +
        '<span class="calc-up-main">';
      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        var dotCls = 'calc-dot';
        if (item.kind === 'milestone' || item.kind === 'festival') dotCls += ' is-gold';
        html += '<span class="calc-up-item"><i class="' + dotCls + '"></i>' +
          '<span class="calc-up-title">' + esc(item.title) + '</span>' +
          (item.tag ? '<span class="calc-chip">' + esc(item.tag) + '</span>' : '') +
          '</span>';
        rows++;
      }
      html += '</span><span class="calc-up-lunar">' + esc(lunarShort(group.key)) + '</span></button>';
    }
    if (i < groups.length) {
      html += '<div class="calc-empty">后面还有更多…</div>';
    }
    box.innerHTML = html;
  }

  function paintMilestones() {
    var box = S.els && S.els.milestones;
    if (!box) return;
    var anchors = anchorList();
    if (!anchors.length) {
      box.innerHTML = '<div class="calc-empty">还没有可计算的锚点纪念日。' +
        '在事件的开始日期（anchorDate）里填上「在一起的第一天」，' +
        '这里就会自动列出 100 / 200 / … / 1000 天和每年周年。</div>';
      return;
    }
    var html = '';
    var today = todayKey();
    for (var i = 0; i < anchors.length; i++) {
      var event = anchors[i];
      var rows = milestoneRows(event);
      if (!rows.length) continue;
      html += '<div class="calc-ms-group">' +
        '<div class="calc-ms-head"><b>' + esc(event.title || '纪念日') + '</b>' +
        '<span class="calc-ms-anchor">' + esc(eventAnchorDate(event)) + '</span></div>';
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j];
        var date = parseKey(row.dateKey);
        var rel = relText(row.dateKey);
        var title = msTitle(event, row);
        var exists = eventExistsOn(row.dateKey, title);
        var future = diffKey(today, row.dateKey) >= 0;
        html += '<div class="calc-row calc-ms">' +
          '<button type="button" class="calc-ms-date" data-act="day" data-key="' + row.dateKey + '"' +
          ' title="跳到这一天">' + esc(fmtMonthDay(date)) + '</button>' +
          '<div class="calc-row-main"><b class="calc-row-title">' + esc(event.title || '纪念日') + '</b>' +
          '<span class="calc-tags">' +
          '<span class="calc-chip' + (row.kind === 'year' ? ' is-gold' : '') + '">' + esc(row.tag) + '</span>' +
          (lunarShort(row.dateKey) ? '<span class="calc-chip">农历 ' + esc(lunarShort(row.dateKey)) + '</span>' : '') +
          '</span></div>' +
          '<span class="calc-rel' + (row.dateKey === today ? ' is-today' : '') + '">' + esc(rel) + '</span>' +
          (exists
            ? '<span class="calc-chip">已提醒</span>'
            : (future
              ? '<button type="button" class="calc-btn is-mini" data-act="ms-remind"' +
              ' data-date="' + row.dateKey + '" data-title="' + esc(title) + '">设为提醒</button>'
              : '')) +
          '</div>';
      }
      html += '</div>';
    }
    box.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 8. 表单                                                             */
  /* ------------------------------------------------------------------ */

  function modalOpen() {
    return !!(S.els && S.els.modal && !S.els.modal.hidden);
  }

  function formMsg(text, kind) {
    var node = S.els && S.els.fMsg;
    if (!node) return;
    if (!text) {
      node.hidden = true;
      node.textContent = '';
      node.className = 'calc-msg';
      return;
    }
    node.hidden = false;
    node.textContent = text;
    node.className = 'calc-msg' + (kind ? ' is-' + kind : '');
  }

  function setFormBusy(busy) {
    var btn = S.els && S.els.fSave;
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? '保存中…' : '保存';
  }

  function updateFormVisibility() {
    var els = S.els;
    var form = S.form;
    if (!els || !form) return;
    var lunar = form.calendar === 'lunar';
    /* 农历事件也要一个公历起始日（宿主按它算第几天/岁数），所以都显示 */
    showEl(els.fSolarWrap, true);
    showEl(els.fLunarWrap, lunar);
    showEl(els.fLunarHint, lunar);
    var solarLabel = els.fSolarWrap ? els.fSolarWrap.querySelector('.calc-field-label') : null;
    if (solarLabel) solarLabel.textContent = lunar ? '公历起始日（算第几天用）' : '公历日期';
    if (els.fCal) {
      var buttons = els.fCal.querySelectorAll('[data-act="f-cal"]');
      for (var i = 0; i < buttons.length; i++) {
        var value = buttons[i].getAttribute('data-val');
        buttons[i].className = 'calc-seg-btn' + (value === form.calendar ? ' is-on' : '');
      }
    }
    if (els.fRepeat) {
      els.fRepeat.disabled = lunar;
      if (lunar) els.fRepeat.checked = true;
    }
    if (els.fDelete) showEl(els.fDelete, !!form.id);
    setText(els.formTitle, form.id ? '编辑事件' : '新增事件');
  }

  function seedFromEvent(event) {
    var els = S.els;
    if (!els || !event) return;
    setText(els.fTitle, event.title || '');
    if (els.fTitle) els.fTitle.value = event.title || '';
    var calendar = event.calendar === 'lunar' ? 'lunar' : 'solar';
    S.form.calendar = calendar;
    S.form.type = event.type || 'custom';
    S.form.color = event.color || 'rose';
    S.form.id = event.id || '';
    var repeat = event.repeat !== 'once';
    if (els.fRepeat) els.fRepeat.checked = repeat;
    if (els.fTime) els.fTime.value = event.remindTime || '09:00';
    /* 日期：宿主 stateView 给 start（也兼容契约的 date） */
    var rawDate = typeof event.start === 'string' ? event.start
      : (typeof event.date === 'string' ? event.date : '');
    var dateValue = '';
    if (rawDate) {
      if (rawDate.length === 10) dateValue = rawDate;
      else dateValue = new Date().getFullYear() + '-' + rawDate;
    }
    if (!dateValue && S.selected) dateValue = S.selected;
    if (els.fDate && dateValue) els.fDate.value = dateValue;
    /* 农历字段 */
    if (calendar === 'lunar') {
      var month = parseInt(event.lunarMonth, 10);
      var day = parseInt(event.lunarDay, 10);
      if (els.fLeap) els.fLeap.checked = !!event.lunarLeap;
      if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 30)) {
        var seedKey = event.date && event.date.length === 10 ? event.date : dateValue;
        var info = seedKey ? lunarOf(seedKey) : null;
        if (info && typeof info.month === 'number' && typeof info.day === 'number') {
          month = info.month;
          day = info.day;
          if (els.fLeap) els.fLeap.checked = !!info.leap;
        }
      }
      if (els.fLMonth) els.fLMonth.value = String(month >= 1 && month <= 12 ? month : 1);
      if (els.fLDay) els.fLDay.value = String(day >= 1 && day <= 30 ? day : 1);
      S.form.seedLunar = {
        month: month >= 1 && month <= 12 ? month : 1,
        day: day >= 1 && day <= 30 ? day : 1,
        leap: !!(els.fLeap && els.fLeap.checked)
      };
    }
    /* 提前提醒 */
    var leads = Array.isArray(event.leadDays) ? event.leadDays : [7, 1, 0];
    if (els.fLeads) {
      var boxes = els.fLeads.querySelectorAll('input[data-lead]');
      for (var i = 0; i < boxes.length; i++) {
        var value = parseInt(boxes[i].getAttribute('data-lead'), 10);
        boxes[i].checked = leads.indexOf(value) >= 0;
      }
    }
  }

  function openForm(event) {
    var els = S.els;
    if (!els || !els.modal) return;
    S.form = {
      id: '',
      type: 'custom',
      color: 'rose',
      calendar: 'solar'
    };
    if (els.fTitle) els.fTitle.value = '';
    if (els.fDate) els.fDate.value = S.selected && isKey(S.selected) ? S.selected : todayKey();
    if (els.fTime) els.fTime.value = '09:00';
    if (els.fRepeat) els.fRepeat.checked = true;
    if (els.fLeap) els.fLeap.checked = false;
    if (els.fLMonth) els.fLMonth.value = '1';
    if (els.fLDay) els.fLDay.value = '1';
    if (els.fLeads) {
      var boxes = els.fLeads.querySelectorAll('input[data-lead]');
      for (var i = 0; i < boxes.length; i++) {
        var value = parseInt(boxes[i].getAttribute('data-lead'), 10);
        boxes[i].checked = value === 7 || value === 1 || value === 0;
      }
    }
    if (event) seedFromEvent(event);
    updateFormVisibility();
    formMsg('');
    setFormBusy(false);
    els.modal.hidden = false;
    try { if (els.fTitle) els.fTitle.focus(); } catch (err) { /* 忽略 */ }
  }

  function closeForm() {
    if (S.els && S.els.modal) S.els.modal.hidden = true;
    S.form = null;
    formMsg('');
  }

  function readForm() {
    var els = S.els;
    var form = S.form;
    if (!els || !form) return { ok: false, msg: '表单未就绪' };
    var title = String((els.fTitle && els.fTitle.value) || '').trim();
    if (!title) return { ok: false, msg: '请先给事件起个标题' };
    var calendar = form.calendar === 'lunar' ? 'lunar' : 'solar';
    var repeat = !!(els.fRepeat && els.fRepeat.checked);
    var leads = [];
    if (els.fLeads) {
      var boxes = els.fLeads.querySelectorAll('input[data-lead]');
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) leads.push(parseInt(boxes[i].getAttribute('data-lead'), 10));
      }
    }
    if (!leads.length) leads.push(0);
    var time = String((els.fTime && els.fTime.value) || '').trim();
    if (!time) time = '09:00';
    var payload = {
      title: title,
      type: form.type || 'custom',
      calendar: calendar,
      repeat: repeat ? 'yearly' : 'once',
      leadDays: leads,
      remindTime: time,
      color: form.color || 'rose',
      note: '',
      tag: ''
    };
    if (calendar === 'lunar') {
      if (!repeat) return { ok: false, msg: '农历事件请勾选「每年重复」' };
      var lMonth = parseInt((els.fLMonth && els.fLMonth.value) || '1', 10) || 1;
      var lDay = parseInt((els.fLDay && els.fLDay.value) || '1', 10) || 1;
      var lLeap = !!(els.fLeap && els.fLeap.checked);
      if (form.id && form.seedLunar) {
        var sameLunar = form.seedLunar.month === lMonth &&
          form.seedLunar.day === lDay &&
          !!form.seedLunar.leap === lLeap;
        if (!sameLunar) {
          return { ok: false, msg: '农历日期暂时改不了：先删掉这条，再按新农历日期加一条。' };
        }
      }
      payload.lunarMonth = lMonth;
      payload.lunarDay = lDay;
      payload.lunarLeap = lLeap;
      payload.lunarIsLeap = lLeap; /* 宿主 ops.js 的字段名 */
      /* 宿主 addEvent 必须要一个合法公历起点（用来算第几天 / 几岁） */
      var anchorKey = String((els.fDate && els.fDate.value) || '').trim();
      if (!isKey(anchorKey)) anchorKey = isKey(S.selected) ? S.selected : todayKey();
      payload.date = anchorKey;
      payload.start = anchorKey;
    } else {
      var dateKey = String((els.fDate && els.fDate.value) || '').trim();
      if (!isKey(dateKey)) return { ok: false, msg: '请选择公历日期' };
      /* 带年份传：宿主用 start 年份算「第几天 / 几岁」，只传 MM-DD 会丢年份 */
      payload.date = dateKey;
      payload.start = dateKey;
    }
    return { ok: true, payload: payload };
  }

  function saveForm() {
    var form = S.form;
    if (!form) return;
    var parsed = readForm();
    if (!parsed.ok) {
      formMsg(parsed.msg, 'error');
      return;
    }
    var editing = !!form.id;
    var payload = parsed.payload;
    if (editing) payload.id = form.id;
    setFormBusy(true);
    formMsg('');
    safeOp(editing ? 'event.update' : 'event.add', payload).then(function (state) {
      setFormBusy(false);
      if (!state) return;
      closeForm();
      flash(editing ? '已保存事件' : '已添加事件', 'ok');
    }, function () {
      setFormBusy(false);
      formMsg('保存失败，稍后重试', 'error');
    });
  }

  function deleteEvent(id) {
    if (!id) return;
    if (!needConfirm('ev:' + id, S.els && S.els.fDelete)) return;
    safeOp('event.delete', { id: id }).then(function (state) {
      if (!state) return;
      closeForm();
      flash('已删除事件', 'ok');
    }, function () { /* 已提示 */ });
  }

  function needConfirm(key, button) {
    var now = Date.now();
    if (S.confirm[key] && now - S.confirm[key] < 4000) {
      delete S.confirm[key];
      return true;
    }
    S.confirm[key] = now;
    if (button) button.textContent = '再点一次确认';
    setTimeout(function () {
      if (S.confirm[key] === now) {
        delete S.confirm[key];
        schedulePaint();
      }
    }, 4000);
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* 9. op 封装与动作                                                    */
  /* ------------------------------------------------------------------ */

  /* 宿主 lib/api.js 的 op 名是驼峰（addEvent/addDdl/updateDdl…），
     契约 §3 写的是点号（event.add / ddl.toggle…）。两种都试，谁先认就用谁。 */
  var OP_ALIAS = {
    'event.add': 'addEvent',
    'event.update': 'updateEvent',
    'event.delete': 'deleteEvent',
    'ddl.add': 'addDdl',
    'ddl.update': 'updateDdl',
    'ddl.toggle': 'updateDdl',
    'ddl.delete': 'deleteDdl'
  };

  function opUnknownError(err) {
    var msg = String((err && err.message) || err || '');
    return msg.indexOf('unknown op') >= 0 || msg.indexOf('unknown route') >= 0 || /not found/i.test(msg);
  }

  function adoptState(state) {
    if (state && typeof state === 'object') {
      S.data = state;
      S.error = '';
      return true;
    }
    return false;
  }

  function callOp(opName, payload) {
    var api = S.api;
    if (!api || typeof api.op !== 'function') return null;
    try {
      return Promise.resolve(api.op(opName, payload || {}));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /* 先按上一次成功过的命名风格发；还没定就按契约点号先试 */
  function opCandidates(name) {
    var alias = OP_ALIAS[name];
    var list = [];
    if (S.opStyle === 'camel' && alias && alias !== name) list.push(alias, name);
    else {
      list.push(name);
      if (alias && alias !== name) list.push(alias);
    }
    return list;
  }

  function runOp(name, body, index) {
    var list = opCandidates(name);
    var opName = list[index];
    if (!opName) return Promise.reject(new Error('unknown-op-name'));
    var pending = callOp(opName, body);
    if (!pending) return Promise.reject(new Error('no-op-api'));
    return pending.then(function (state) {
      S.opStyle = opName === name ? 'contract' : 'camel';
      return state;
    }, function (err) {
      if (index + 1 < list.length && opUnknownError(err)) return runOp(name, body, index + 1);
      throw err;
    });
  }

  function safeOp(name, payload) {
    var body = payload || {};
    if (!S.api || typeof S.api.op !== 'function') {
      flash('接口未就绪，操作失败', 'error');
      return Promise.reject(new Error('no-op-api'));
    }
    return runOp(name, body, 0).then(function (state) {
      adoptState(state);
      schedulePaint();
      return state;
    }, function (err) {
      var why = (err && (err.message || err.error)) || ''
      flash('操作失败' + (why ? '：' + why : '，请稍后重试'), 'error');
      throw err;
    });
  }

  /* 可选操作：失败完全不打扰用户（提醒 ack / 静默同步等） */
  function quietOp(name, payload) {
    var body = payload || {};
    if (!S.api || typeof S.api.op !== 'function') return Promise.resolve(null);
    return runOp(name, body, 0).then(function (state) {
      adoptState(state);
      schedulePaint();
      return state;
    }, function () {
      return null;
    });
  }

  function actOf(node) {
    while (node && node !== S.root) {
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-act')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function onClick(event) {
    var target = actOf(event.target);
    if (!target) return;
    var act = target.getAttribute('data-act');
    var dateKey;
    if (act === 'prev-month') {
      shiftMonth(-1);
    } else if (act === 'next-month') {
      shiftMonth(1);
    } else if (act === 'today') {
      goToday();
    } else if (act === 'day') {
      dateKey = target.getAttribute('data-key');
      openDay(dateKey);
    } else if (act === 'toggle-mode') {
      toggleMode();
    } else if (act === 'new-event') {
      openForm(null);
    } else if (act === 'new-ddl') {
      focusDdlInput();
    } else if (act === 'event-edit') {
      var editing = findEvent(target.getAttribute('data-id'));
      if (editing) openForm(editing);
      else flash('没找到这条事件，可能已被删除', 'error');
    } else if (act === 'ddl-toggle') {
      toggleDdl(target.getAttribute('data-id'));
    } else if (act === 'ddl-del') {
      armDdlDelete(target.getAttribute('data-id'));
    } else if (act === 'ddl-del-yes') {
      var yesId = target.getAttribute('data-id');
      if (S.confirm) delete S.confirm['ddl:' + yesId];
      deleteDdl(yesId);
    } else if (act === 'ddl-del-cancel') {
      armDdlDelete(target.getAttribute('data-id'), true);
    } else if (act === 'ddl-add') {
      addDdl();
    } else if (act === 'f-cal') {
      if (S.form) {
        S.form.calendar = target.getAttribute('data-val') === 'lunar' ? 'lunar' : 'solar';
        updateFormVisibility();
      }
    } else if (act === 'modal-close') {
      closeForm();
    } else if (act === 'form-save') {
      saveForm();
    } else if (act === 'form-delete') {
      if (S.form && S.form.id) deleteEvent(S.form.id);
    } else if (act === 'ms-remind') {
      setMsReminder(target.getAttribute('data-date'), target.getAttribute('data-title'), target);
    } else if (act === 'retry') {
      refresh();
    }
  }

  function onKeyDown(event) {
    var key = event.key || '';
    if (key === 'Escape') {
      if (modalOpen()) {
        closeForm();
        try { event.stopPropagation(); } catch (err) { /* 忽略 */ }
      }
      return;
    }
    if (key !== 'Enter') return;
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var ref = target.getAttribute('data-ref');
    if (ref === 'ddlInput') {
      event.preventDefault();
      addDdl();
      return;
    }
    if (modalOpen() && ref && ref.charAt(0) === 'f' && target.tagName !== 'SELECT' && target.tagName !== 'TEXTAREA') {
      event.preventDefault();
      saveForm();
    }
  }

  function onInput(event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    if (target.getAttribute('data-ref') === 'ddlInput') {
      S.ddlDraft = String(target.value || '');
    }
  }

  function shiftMonth(delta) {
    var view = currentView();
    var month = view.m + delta;
    var year = view.y;
    while (month < 1) { month += 12; year--; }
    while (month > 12) { month -= 12; year++; }
    S.entry = { y: year, m: month };
    schedulePaint();
    refresh();
  }

  function goToday() {
    var today = todayKey();
    var date = parseKey(today);
    S.entry = { y: date.getFullYear(), m: date.getMonth() + 1 };
    S.selected = today;
    schedulePaint();
    refresh();
  }

  function openDay(dateKey) {
    if (!isKey(dateKey)) return;
    var date = parseKey(dateKey);
    var view = currentView();
    var changed = view.y !== date.getFullYear() || view.m !== date.getMonth() + 1;
    if (changed) S.entry = { y: date.getFullYear(), m: date.getMonth() + 1 };
    S.selected = dateKey;
    schedulePaint();
    if (changed) refresh();
    else paint();
  }

  function addDdl() {
    var input = S.els && S.els.ddlInput;
    var title = String((input && input.value) || S.ddlDraft || '').trim();
    if (!title) {
      flash('先写一条 DDL 内容', 'error');
      focusDdlInput();
      return;
    }
    var dateKey = S.selected && isKey(S.selected) ? S.selected : todayKey();
    safeOp('ddl.add', { date: dateKey, title: title, time: '', priority: 'normal' }).then(function (state) {
      if (!state) return;
      S.ddlDraft = '';
      if (input) input.value = '';
      flash('已添加 DDL', 'ok');
      S.focusDdl = true;
      schedulePaint();
    }, function () { /* 已提示 */ });
  }

  function toggleDdl(id) {
    var ddl = findDdl(id);
    if (!ddl) return;
    safeOp('ddl.toggle', { id: id, done: !ddl.done }).then(function () { /* paint 由 safeOp 触发 */ },
      function () { /* 已提示 */ });
  }

  function armDdlDelete(id, cancel) {
    if (!id) return;
    S.confirm = S.confirm || {};
    if (cancel) {
      delete S.confirm['ddl:' + id];
      schedulePaint();
      return;
    }
    var stamp = Date.now();
    S.confirm['ddl:' + id] = stamp;
    schedulePaint();
    setTimeout(function () {
      if (S.confirm && S.confirm['ddl:' + id] === stamp) {
        delete S.confirm['ddl:' + id];
        schedulePaint();
      }
    }, 6000);
  }

  function deleteDdl(id) {
    var ddl = findDdl(id);
    if (!ddl) {
      flash('没找到这条 DDL，可能已被删除', 'error');
      return;
    }
    safeOp('ddl.delete', { id: id }).then(function (state) {
      if (state) flash('已删除 DDL', 'ok');
    }, function () { /* 已提示 */ });
  }

  function setMsReminder(dateKey, title, button) {
    if (!isKey(dateKey) || !title) return;
    var label = title;
    safeOp('event.add', {
      title: label,
      type: 'custom',
      calendar: 'solar',
      date: dateKey,
      repeat: 'once',
      leadDays: [1, 0],
      remindTime: '09:00',
      note: '里程碑提醒',
      tag: 'milestone',
      color: 'gold'
    }).then(function (state) {
      if (!state) return;
      if (button) button.textContent = '已提醒';
      flash('已设为提醒，到时候会通知你', 'ok');
    }, function () { /* 已提示 */ });
  }

  function focusDdlInput() {
    var input = S.els && S.els.ddlInput;
    if (!input) {
      S.focusDdl = true;
      schedulePaint();
      return;
    }
    try { input.focus(); } catch (err) { /* 忽略 */ }
    scrollIntoViewSafe(input);
  }

  /* ------------------------------------------------------------------ */
  /* 10. 醒目提醒卡                                                      */
  /* ------------------------------------------------------------------ */

  function reminderKey(rem) {
    return [rem.id || '', rem.kind || '', rem.dateKey || '', rem.at || '', rem.title || ''].join('|');
  }

  function trimShown() {
    var keys = Object.keys(S.shown);
    if (keys.length <= 80) return;
    for (var i = 0; i < keys.length - 60; i++) delete S.shown[keys[i]];
  }

  function showReminder(rem) {
    if (!rem || typeof rem !== 'object' || rem.acked) return;
    var key = reminderKey(rem);
    if (S.shown[key]) return;
    S.shown[key] = true;
    trimShown();
    if (S.rem) {
      S.remQueue.push(rem);
      return;
    }
    S.rem = rem;
    renderReminderCard();
    playReminderExtras(rem);
  }

  function ensureRemLayer() {
    if (S.destroyed) return S.remLayer;
    var host = S.overlay;
    if (!connected(host)) host = null;
    if (!host) {
      if (connected(S.pane)) host = S.pane;
      else if (S.coach && typeof S.coach.root === 'function') {
        var coachRoot = null;
        try { coachRoot = S.coach.root(); } catch (err) { coachRoot = null; }
        if (connected(coachRoot)) host = coachRoot;
      }
    }
    if (!host) return S.remLayer;
    injectStyles(host);
    if (S.remLayer && connected(S.remLayer) && S.remLayer.parentNode === host) return S.remLayer;
    if (S.remLayer && S.remLayer.parentNode) S.remLayer.parentNode.removeChild(S.remLayer);
    var layer = el('div', 'calc-rem-layer');
    layer.hidden = true;
    layer.addEventListener('click', onRemClick);
    host.appendChild(layer);
    S.remLayer = layer;
    return layer;
  }

  function isImportantLevel(level) {
    if (level === true) return true;
    var s = String(level || '').toLowerCase();
    return s === 'important' || s === 'high' || s === 'urgent' || s === 'critical';
  }

  function buildRemSub(rem) {
    var parts = [];
    var key = rem.dateKey && isKey(rem.dateKey) ? rem.dateKey : '';
    if (key) {
      parts.push('<span class="calc-rem-chip">' + esc(fmtDateLong(parseKey(key))) + '</span>');
      parts.push('<span class="calc-rem-chip">' + esc(relText(key)) + '</span>');
      var lunar = lunarTextOf(key);
      if (lunar) parts.push('<span class="calc-rem-chip">' + esc(lunar) + '</span>');
      lunarEnsure([key]);
    }
    if (rem.at) {
      var clock = '';
      if (/^\d{1,2}:\d{2}$/.test(String(rem.at))) {
        clock = String(rem.at);
      } else {
        var at = new Date(rem.at);
        if (!isNaN(at.getTime())) clock = pad2(at.getHours()) + ':' + pad2(at.getMinutes());
      }
      if (clock) parts.push('<span class="calc-rem-chip">' + esc(clock) + '</span>');
    }
    return parts.join('');
  }

  function renderReminderCard() {
    if (!S.rem) {
      if (S.remLayer) {
        S.remLayer.hidden = true;
        S.remLayer.innerHTML = '';
      }
      return;
    }
    var layer = ensureRemLayer();
    if (!layer) return;
    var rem = S.rem;
    var important = isImportantLevel(rem.level);
    var kindLabel = REM_KIND_LABEL[rem.kind] || '提醒';
    var sub = buildRemSub(rem);
    var html = '<div class="calc-rem' + (important ? ' is-important' : '') + '" role="alertdialog"' +
      ' aria-live="assertive" aria-label="' + esc(rem.title || kindLabel) + '">' +
      '<div class="calc-rem-top">' +
      '<span class="calc-rem-badge">' + esc(important ? '重要提醒' : kindLabel) + '</span>' +
      '<button type="button" class="calc-rem-x" data-act="rem-sound" title="' + (S.soundOn ? '关闭提示音' : '开启提示音') + '">' +
      (S.soundOn ? '\uD83D\uDD14' : '\uD83D\uDD15') + '</button>' +
      '<button type="button" class="calc-rem-x" data-act="rem-close" title="关闭">\u00D7</button>' +
      '</div>' +
      '<div class="calc-rem-title">' + esc(rem.title || kindLabel) + '</div>' +
      (sub ? '<div class="calc-rem-sub">' + sub + '</div>' : '') +
      (rem.body ? '<div class="calc-rem-body">' + esc(rem.body) + '</div>' : '') +
      '<div class="calc-rem-actions">' +
      '<button type="button" class="calc-rem-btn is-primary" data-act="rem-ack">知道了</button>' +
      '<button type="button" class="calc-rem-btn" data-act="rem-snooze">10 分钟后再提醒</button>' +
      '<button type="button" class="calc-rem-btn is-ghost" data-act="rem-open">打开日历</button>' +
      '</div></div>';
    layer.hidden = false;
    layer.innerHTML = html;
  }

  function onRemClick(event) {
    var node = event.target;
    while (node && node !== S.remLayer) {
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-act')) break;
      node = node.parentNode;
    }
    if (!node || node === S.remLayer) return;
    var act = node.getAttribute('data-act');
    if (act === 'rem-ack' || act === 'rem-close') {
      ackReminder('ack');
    } else if (act === 'rem-snooze') {
      ackReminder('snooze');
    } else if (act === 'rem-open') {
      var key = S.rem && S.rem.dateKey;
      ackReminder('ack');
      openCalendarFromReminder(key);
    } else if (act === 'rem-sound') {
      S.soundOn = !S.soundOn;
      renderReminderCard();
    }
  }

  function closeReminderCard() {
    S.rem = null;
    if (S.remLayer) {
      S.remLayer.hidden = true;
      S.remLayer.innerHTML = '';
    }
  }

  function snoozeReminder(rem, minutes) {
    if (!rem) return;
    var wait = (minutes > 0 ? minutes : 10) * 60 * 1000;
    var timer = 0;
    var fire = function () {
      for (var i = 0; i < S.snoozeTimers.length; i++) {
        if (S.snoozeTimers[i] === timer) { S.snoozeTimers.splice(i, 1); break; }
      }
      if (S.destroyed) return;
      S.remQueue.push(rem);
      showNextReminder();
    };
    try {
      timer = window.setTimeout(fire, wait);
    } catch (err) {
      return;
    }
    S.snoozeTimers.push(timer);
  }

  function ackReminder(kind) {
    var rem = S.rem;
    if (!rem) {
      showNextReminder();
      return;
    }
    var id = rem.id;
    closeReminderCard();
    if (kind === 'snooze') {
      /* 宿主没有 snooze 这个 op 时也能用：本地 10 分钟后再弹一次 */
      snoozeReminder(rem, 10);
      quietOp('reminder.snooze', { id: id, minutes: 10 });
    } else {
      /* shell 自己会 markFired；这里只顺手同步一次，失败静默 */
      quietOp('reminder.ack', { id: id, keys: rem.keys || [] });
    }
    showNextReminder();
  }

  function showNextReminder() {
    if (S.rem) return;
    while (S.remQueue.length) {
      var next = S.remQueue.shift();
      if (!next) continue;
      S.rem = next;
      renderReminderCard();
      playReminderExtras(next);
      return;
    }
  }

  function openCalendarFromReminder(dateKey) {
    try {
      if (typeof S.onOpenCoachTab === 'function') S.onOpenCoachTab('calendar');
      else if (S.coach && typeof S.coach.switchTab === 'function') S.coach.switchTab('calendar');
    } catch (err) { /* 打不开也不影响 */ }
    if (isKey(dateKey)) openDay(dateKey);
    else if (S.root) schedulePaint();
  }

  function playReminderExtras(rem) {
    try { notifySystem(rem); } catch (err) {}
    try { playChime(); } catch (err2) {}
  }

  function playChime() {
    if (!S.soundOn) return;
    var Ctx = null;
    try {
      Ctx = window.AudioContext || window.webkitAudioContext || null;
    } catch (err) { Ctx = null; }
    if (!Ctx) return;
    try {
      if (!S.audio) S.audio = new Ctx();
      var ctx = S.audio;
      if (!ctx) return;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try {
          var resumed = ctx.resume();
          if (resumed && typeof resumed.catch === 'function') resumed.catch(function () {});
        } catch (err2) { /* 自动播放策略拦截，静默 */ }
      }
      var freqs = [880, 1174.66, 1567.98];
      var start = ctx.currentTime + 0.02;
      for (var i = 0; i < freqs.length; i++) {
        var at = start + i * 0.16;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqs[i], at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.36);
      }
    } catch (err3) { /* 失败静默 */ }
  }

  function notifySystem(rem) {
    try {
      if (typeof Notification === 'undefined' || !Notification) return;
      var title = rem.title || '日历提醒';
      var body = rem.body || (rem.dateKey ? '日期：' + rem.dateKey : '');
      if (Notification.permission === 'granted') {
        try {
          var notice = new Notification(title, {
            body: body,
            tag: 'calc-' + String(rem.id || ''),
            silent: true
          });
          if (notice && typeof notice.close === 'function') {
            setTimeout(function () {
              try { notice.close(); } catch (err) {}
            }, 12000);
          }
        } catch (err) { /* 静默 */ }
        return;
      }
      if (Notification.permission === 'default' && !S.notifyAsked) {
        S.notifyAsked = true;
        try {
          var pending = Notification.requestPermission(function () {});
          if (pending && typeof pending.catch === 'function') pending.catch(function () {});
        } catch (err2) { /* 静默 */ }
      }
    } catch (err3) { /* 静默 */ }
  }

  /* ------------------------------------------------------------------ */
  /* 11. 公共 API                                                        */
  /* ------------------------------------------------------------------ */

  function mount(opts) {
    opts = opts || {};
    S.destroyed = false;
    S.mounted = true;
    if (opts.coach) S.coach = opts.coach;
    if (opts.api) S.api = opts.api;
    if (opts.overlay) S.overlay = opts.overlay;
    if (typeof opts.onOpenCoachTab === 'function') S.onOpenCoachTab = opts.onOpenCoachTab;
    if (opts.mode === 'card' || opts.mode === 'page') S.mode = opts.mode;
    if (S.overlay && connected(S.overlay)) injectStyles(S.overlay);
    if (!S.resizeBound) {
      S.resizeBound = true;
      try { window.addEventListener('resize', onViewportResize); } catch (err) { S.resizeBound = false; }
    }
    return API;
  }

  function renderPane(container) {
    if (S.destroyed) return;
    var host = container || null;
    if (!host && S.coach && typeof S.coach.calendarPane === 'function') {
      try { host = S.coach.calendarPane(); } catch (err) { host = null; }
    }
    if (!host) host = S.pane;
    if (!host) return;
    S.pane = host;
    if (!ensureRoot(host)) return;
    paint();
    if (!S.data && !S.loading) refresh();
  }

  function refresh() {
    if (S.destroyed) return;
    var api = S.api;
    var range = gridRange();
    S.loading = true;
    if (!S.data) S.error = '';
    paintLoading();
    var promise;
    try {
      if (api && typeof api.state === 'function') {
        promise = api.state(keyOfDate(range.start), keyOfDate(range.end));
      } else {
        throw new Error('no-state-api');
      }
    } catch (err) {
      promise = Promise.reject(err);
    }
    Promise.resolve(promise).then(function (state) {
      if (S.destroyed) return;
      S.loading = false;
      if (state && typeof state === 'object') {
        S.data = state;
        S.error = '';
      } else if (!S.data) {
        S.error = '数据格式异常，稍后重试';
      }
      schedulePaint();
    }, function () {
      if (S.destroyed) return;
      S.loading = false;
      if (!S.data) S.error = '加载失败，稍后重试';
      else S.error = '刷新失败，仍在显示上次数据';
      schedulePaint();
    });
  }

  function destroy() {
    S.destroyed = true;
    S.mounted = false;
    if (S.resizeBound) {
      try { window.removeEventListener('resize', onViewportResize); } catch (err) { /* ignore */ }
      S.resizeBound = false;
    }
    if (S.paintTimer) { clearTimeout(S.paintTimer); S.paintTimer = null; }
    if (S.flashTimer) { clearTimeout(S.flashTimer); S.flashTimer = null; }
    if (S.remLayer && S.remLayer.parentNode) S.remLayer.parentNode.removeChild(S.remLayer);
    S.remLayer = null;
    S.rem = null;
    S.remQueue = [];
    for (var t = 0; t < S.snoozeTimers.length; t++) {
      try { clearTimeout(S.snoozeTimers[t]); } catch (errT) { /* ignore */ }
    }
    S.snoozeTimers = [];
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    S.root = null;
    S.els = null;
    S.bound = false;
    S.pane = null;
    S.domMode = '';
    S.compact = null;
    S.narrow = null;
    S.form = null;
    S.flash = null;
    for (var i = 0; i < S.styles.length; i++) {
      if (S.styles[i] && S.styles[i].parentNode) S.styles[i].parentNode.removeChild(S.styles[i]);
    }
    S.styles = [];
    S.lunarQueue = [];
    S.lunarBusy = {};
    S.lunarInflight = 0;
    S.confirm = {};
    S.opStyle = '';
    S.entry = null;
    S.selected = '';
    if (S.audio) {
      try { if (typeof S.audio.close === 'function') S.audio.close(); } catch (err) {}
      S.audio = null;
    }
  }

  var API = {
    mount: mount,
    renderPane: renderPane,
    refresh: refresh,
    openDay: openDay,
    showReminder: showReminder,
    destroy: destroy,
    /* 额外便利方法（不属于契约必需项，供 shell 同步形态文案） */
    setMode: setMode,
    root: function () { return S.root; }
  };

  return API;
})();
