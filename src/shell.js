/* dsh-calendar-coach — src/shell.js
 *
 * 浏览器端外壳：把 COACH（合并后的每日教练）和 CAL（日历页 + 提醒卡）
 * 装进 DSH 的三个座位，并负责两件事：
 *   1. 形态切换：card（右下角浮卡）/ page（center 列的整页）
 *   2. 提醒轮询：每 20 秒问一次宿主 /pending，到点的提醒交给 CAL 弹卡
 *
 * 座位（都用 ctx.slots.inject，宿主声明了我才注册）：
 *   sidebar.panellist  侧栏一行图标
 *   main (keyed)       整页：日历 + 教练五个页签
 *   shell.overlay      浮卡宿主 + 提醒层
 *
 * 片段规则见 CONTRACT.md §1：ES5、唯一顶层绑定 apply、不 import。
 * React 由 factory 的 require('react') 提供（与内置插件一致）。
 */

function apply(ctx) {
  /* 座位服务没到就安静退出（比抛错好：抛错会让整个 client module fiber 缺失） */
  if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
    try { console.error('[dsh-calendar] 座位服务不可用，界面未挂载'); } catch (e) {}
    return;
  }

  var React = require('react');

  var API = '/api/dsh-calendar';
  var HEADERS = { 'content-type': 'application/json', 'x-dsh-calendar': '1' };
  var POLL_MS = 20000;
  var PANEL_ID = 'dsh-calendar-coach';
  var STYLE_ID = 'dsh-calendar-coach-shell-style';

  /* ---------------- 小工具 ---------------- */

  var S = {
    mode: 'card',
    pageMounted: false,
    overlayMounted: false,
    host: null,
    calReady: false,
    remHost: null,
    runtimeStarted: false,
    stopRuntime: null,
    listeners: [],
    lastState: null
  };

  function emit() {
    var list = S.listeners.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (err) { /* 单个订阅者出错不影响其它 */ }
    }
  }

  function subscribe(fn) {
    S.listeners.push(fn);
    return function () {
      var i = S.listeners.indexOf(fn);
      if (i >= 0) S.listeners.splice(i, 1);
    };
  }

  function useForceUpdate() {
    var pair = React.useState(0);
    var tick = pair[1];
    return function () { tick(function (n) { return n + 1; }); };
  }

  function req(method, path, body) {
    var init = { method: method, headers: HEADERS, credentials: 'same-origin' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(API + path, init).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || !json || json.ok === false) {
          throw new Error((json && json.error) || ('HTTP ' + res.status));
        }
        return json;
      }, function () {
        throw new Error('HTTP ' + res.status);
      });
    });
  }

  /* 给 CAL 用的 Api（CONTRACT §5.2：全部返回最终数据，不包 ok/data） */
  var api = {
    state: function (from, to) {
      var q = '/state';
      if (from && to) q += '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
      return req('GET', q).then(function (j) { return j.data; });
    },
    today: function (key) {
      var q = '/today';
      if (key) q += '?date=' + encodeURIComponent(key);
      return req('GET', q).then(function (j) { return j.data; });
    },
    /* 压平成 CAL 认识的形状：{ month, day, leap, text, festivals[] } */
    lunar: function (key) {
      return req('GET', '/lunar?date=' + encodeURIComponent(key)).then(function (j) {
        var d = j.data || {};
        var l = d.lunar || {};
        return {
          date: d.date || key,
          month: (typeof l.month === 'number') ? l.month : null,
          day: (typeof l.day === 'number') ? l.day : null,
          leap: !!l.isLeap,
          text: l.text || '',
          monthName: l.monthName || '',
          dayName: l.dayName || '',
          festivals: Array.isArray(d.festivals) ? d.festivals.slice() : [],
          human: d.human || '',
          constellation: d.constellation || ''
        };
      });
    },
    /* op 之后返回最新 state（CAL 会直接拿去重画） */
    op: function (name, payload) {
      return req('POST', '/op', { op: name, payload: payload || {} }).then(function (j) {
        if (j.state) return j.state;
        return api.state();
      });
    },
    mode: function (mode) {
      return req('POST', '/mode', { mode: mode }).then(function (j) { return j.data; });
    },
    pending: function () {
      return req('GET', '/pending').then(function (j) { return j.data || {}; });
    }
  };

  /* ---------------- 形态切换 ---------------- */

  function persistMode(mode) {
    api.mode(mode).then(function () {}, function () { /* 存不上不影响当前会话 */ });
  }

  function setMode(mode, silent) {
    var next = (mode === 'page') ? 'page' : 'card';
    if (S.mode === next) return;
    S.mode = next;
    if (!silent) { persistMode(next); conductor(); emit(); }
  }

  /* ctx.layout 是客户端的"面板导航"服务：selectPanel(id) 才是真正让侧栏切到我们的整页。
     官方的可选访问方式是 ctx.get("layout")（不带 inject 就不会因为服务没就绪而卡在 PENDING）；
     selectPanel(key) 传的必须是 main 槽注册时的 key，传 null 表示回到对话。 */
  var layoutSvc = null;
  function getLayout() {
    if (layoutSvc) return layoutSvc;
    try {
      if (ctx && typeof ctx.get === 'function') {
        var svc = ctx.get('layout');
        if (svc && typeof svc.selectPanel === 'function') {
          layoutSvc = svc;
          return layoutSvc;
        }
      }
    } catch (err) { /* 服务还没就绪：稍后重试 */ }
    try {
      if (ctx && ctx.layout && typeof ctx.layout.selectPanel === 'function') {
        layoutSvc = ctx.layout;
        return layoutSvc;
      }
    } catch (err2) { /* 同上 */ }
    return null;
  }

  function selectPanel(panelId) {
    var svc = getLayout();
    if (!svc) {
      try { console.warn('[dsh-calendar] 拿不到 layout 服务，改为点侧栏入口'); } catch (err) {}
      return false;
    }
    try { svc.selectPanel(panelId); return true; } catch (err3) { return false; }
  }

  /* 拿不到 layout 服务时的兜底：直接点自己的侧栏入口（那一行的点击归 Shell 管，等价于选中面板） */
  function clickSidebarEntry() {
    try {
      var entry = document.querySelector('[data-dsh-panel-entry="' + PANEL_ID + '"]');
      if (!entry) return false;
      var row = (entry.closest && entry.closest('button,[role="button"],a,li')) || entry;
      row.click();
      return true;
    } catch (err) { return false; }
  }

  /* 展开整页 = 切形态 + 让侧栏真正选中我们的面板（只切形态的话，面板没打开时用户什么都看不到） */
  function openPage() {
    setMode('page');
    if (!selectPanel(PANEL_ID) && !S.pageMounted) clickSidebarEntry();
  }

  /* 收回浮卡 = 切回 card + 把主区还给对话 */
  function collapseToCard() {
    setMode('card');
    selectPanel(null);
  }

  function toggleMode() {
    if (S.mode === 'page') collapseToCard();
    else openPage();
  }

  /* 决定 COACH 现在挂在哪个容器里：整页可用且是 page 形态 → 整页；否则浮卡 */
  function conductor() {
    if (typeof COACH === 'undefined' || !COACH) return;
    var usePage = (S.mode === 'page') && S.pageMounted;
    var el = usePage ? S.pageEl : S.coachHost;
    if (!el) return;
    if (S.host === el) {
      try { COACH.setMode(usePage ? 'page' : 'card'); } catch (err) { /* ignore */ }
      return;
    }
    var mounted = false;
    try {
      COACH.opts = {
        mode: usePage ? 'page' : 'card',
        onToggleMode: toggleMode,
        focusApi: {
          dates: function () { return req('GET', '/focus').then(function (j) { return j.data; }); },
          importDates: function (selection) {
            return req('POST', '/op', { op: 'importFocusDates', payload: selection }).then(function (j) {
              if (S.calReady) CAL.refresh();
              return j.data;
            });
          }
        }
      };
      COACH.mount(el);
      COACH.setMode(usePage ? 'page' : 'card');
    } catch (err) {
      /* 渲染中途抛错也要把面板算作已挂载：DOM 已经搬过去了，
         否则 S.host 停在上一个容器，下一次切形态会直接 early-return，面板永远回不来 */
    }
    /* 以 DOM 真实归属为准：root 真的在这个容器里才算挂上了（COACH.root 是取值函数） */
    var coachRoot = null;
    try { coachRoot = (typeof COACH.root === 'function') ? COACH.root() : COACH.root; } catch (err3) { coachRoot = null; }
    if (coachRoot && !el.contains(coachRoot)) return;
    S.host = el;
    if (S.calReady && typeof CAL !== 'undefined' && CAL) {
      try { CAL.renderPane(null); } catch (err2) { /* CAL 会自己重试 */ }
    }
  }

  /* ---------------- 提醒 ---------------- */

  function pumpPending() {
    if (typeof CAL === 'undefined' || !CAL || !S.calReady) return;
    api.pending().then(function (data) {
      var items = (data && data.items) || [];
      var keys = [];
      for (var i = 0; i < items.length; i++) {
        var c = items[i];
        if (!c) continue;
        try {
          CAL.showReminder({
            id: c.id || c.key || '',
            kind: c.kind || 'event',
            dateKey: c.date || '',
            at: c.at || '',
            title: c.title || '日历提醒',
            body: c.text || '',
            level: c.priority || 'normal'
          });
        } catch (err) { /* 单条失败不阻塞其它 */ }
        if (c.key) keys.push(c.key);
      }
      if (keys.length) {
        api.op('markFired', { keys: keys }).then(function () {}, function () {});
      }
    }, function () { /* 宿主还没起来：下个周期再试 */ });
  }

  /* ---------------- 订阅槽位 ---------------- */

  function PanelIcon(props) {
    var size = (props && props.size) || 16;
    return React.createElement('svg', {
      'data-dsh-panel-entry': PANEL_ID,
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true'
    },
    React.createElement('rect', { x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 }),
    React.createElement('path', { d: 'M2 6h12M5.5 2.5v11' }),
    React.createElement('circle', { cx: 9.6, cy: 9.4, r: 1.15, fill: 'currentColor', stroke: 'none' }));
  }

  /* 整页：COACH 以 page 形态铺满 center 列 */
  function PageView() {
    var force = useForceUpdate();
    var slotRef = React.useRef(null);
    React.useEffect(function () { return subscribe(force); }, []);
    React.useEffect(function () {
      S.pageEl = slotRef.current;
      S.pageMounted = !!slotRef.current;
      /* 整页可能比浮层先挂：这里先把 CAL 拉起来，否则日历页会空着 */
      ensureChrome();
      ensureCal();
      /* 打开整页就是把面板展开：形态跟着切到 page，否则面板会留在浮卡里、整页空着 */
      if (S.pageMounted && S.mode !== 'page') setMode('page');
      else conductor();
      return function () {
        var wasPage = S.pageMounted;
        S.pageMounted = false;
        if (S.host && S.host === S.pageEl) S.host = null;
        S.pageEl = null;
        /* 离开整页时把 COACH 交给浮卡，别把面板带走 */
        if (wasPage && S.mode === 'page') setMode('card');
        else { conductor(); emit(); }
      };
    }, []);
    /* 面板被收进浮卡时，整页留一句提示 + 一键展开（COACH 自己不在 React 树里，故用并列容器） */
    var hint = S.mode === 'page' ? null : React.createElement('div', { className: 'calc-page-hint' },
      React.createElement('div', { className: 'calc-page-hint-text' }, '面板已收进右下角的浮卡里，日历页随时可以再展开。'),
      React.createElement('button', {
        type: 'button',
        className: 'calc-btn calc-btn-primary',
        onClick: function () { openPage(); }
      }, '展开整页'));
    return React.createElement('div', { className: 'calc-page' },
      React.createElement('div', { className: 'calc-page-slot', ref: slotRef }),
      hint);
  }

  /* ---------------- 启动底座：与座位无关 ---------------- */

  /* 样式 + 提醒层宿主：建在 body 上，这样即使浮层座位不可用，提醒和整页也照常工作 */
  function ensureChrome() {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = SHELL_CSS;
      document.head.appendChild(style);
    }
    if (!S.remHost) {
      S.remHost = document.createElement('div');
      S.remHost.className = 'calc-rem-host';
      document.body.appendChild(S.remHost);
    }
    return S.remHost;
  }

  /* CAL 只挂一次；谁先挂载谁触发，保证整页先于浮层挂载时日历也有内容 */
  function ensureCal() {
    if (S.calReady) return true;
    if (typeof CAL === 'undefined' || !CAL) return false;
    try {
      CAL.mount({
        coach: (typeof COACH !== 'undefined' && COACH) ? COACH : null,
        api: api,
        overlay: S.remHost,
        mode: S.mode,
        onOpenCoachTab: function () {
          try { if (COACH) COACH.switchTab('calendar'); } catch (err) { /* ignore */ }
          if (!S.pageMounted) setMode('card');
        }
      });
      S.calReady = true;
    } catch (err) {
      S.calReady = false;
      return false;
    }
    var paint = function () {
      try { CAL.renderPane(null); } catch (err) { /* CAL 会自己重试 */ }
    };
    paint();
    setTimeout(paint, 60);
    return true;
  }

  /* 读一次 state（恢复上次形态）→ 开始轮询待弹提醒；只在 apply 里起一次 */
  function startRuntime() {
    if (S.runtimeStarted) return;
    S.runtimeStarted = true;
    var timer = null;
    var stopped = false;
    api.state().then(function (state) {
      if (stopped) return;
      if (state && (state.mode === 'card' || state.mode === 'page')) S.mode = state.mode;
      S.lastState = state || null;
    }, function () { /* 宿主没起来就先用默认 */ }).then(function () {
      if (stopped) return;
      conductor();
      emit();
      pumpPending();
      timer = setInterval(pumpPending, POLL_MS);
    });
    function onFocus() { pumpPending(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    S.stopRuntime = function () {
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      S.runtimeStarted = false;
      S.stopRuntime = null;
    };
  }

  /* 浮层：只提供浮卡宿主；提醒层由 ensureChrome 常驻 */
  function OverlayView() {
    var force = useForceUpdate();
    var coachRef = React.useRef(null);
    React.useEffect(function () { return subscribe(force); }, []);

    React.useEffect(function () {
      S.overlayMounted = true;
      S.coachHost = coachRef.current;
      ensureChrome();
      ensureCal();
      conductor();
      emit();
      return function () {
        S.overlayMounted = false;
        if (S.host && S.host === S.coachHost) S.host = null;
        S.coachHost = null;
      };
    }, []);

    return React.createElement('div', { className: 'calc-coach-host', ref: coachRef });
  }

  var SHELL_CSS = [
    '.calc-shell-overlay{position:fixed;inset:0;z-index:2147482000;pointer-events:none}',
    '.calc-coach-host{position:fixed;left:0;top:0;width:0;height:0;pointer-events:auto}',
    '.calc-rem-host{position:fixed;inset:0;pointer-events:none}',
    '.calc-page{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}',
    /* 整页时给教练面板让出一点内边距，避免贴边 */
    '.calc-page > *{min-height:0}',
    '.calc-page-slot{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
    '.calc-page-hint{flex:0 0 auto;margin:auto;padding:28px 24px;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center;color:var(--dsw-alias-label-secondary,#a0a3ab)}',
    '.calc-page-hint-text{font-size:14px}',
    '.calc-btn{font:inherit;font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#3a3d45);background:var(--dsw-alias-bg-layer-2,#24262c);color:var(--dsw-alias-label-primary,#e6e6e6)}',
    '.calc-btn-primary{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}'
  ].join('\n');

  /* 样式与提醒层先就位：不依赖任何座位，提醒在整页/浮卡任一形态都能弹 */
  ensureChrome();
  startRuntime();
  ctx.effect(function () {
    return function () {
      if (S.stopRuntime) S.stopRuntime();
      if (typeof CAL !== 'undefined' && CAL && S.calReady) {
        try { CAL.destroy(); } catch (err) { /* ignore */ }
        S.calReady = false;
      }
      if (S.remHost && S.remHost.parentNode) S.remHost.parentNode.removeChild(S.remHost);
      S.remHost = null;
      var style = document.getElementById(STYLE_ID);
      if (style) style.remove();
    };
  });

  ctx.slots.inject('sidebar.panellist', function () {
    return ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 30,
      label: function () { return '日历'; }
    }, PanelIcon);
  });

  ctx.slots.inject('main', function () {
    return ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      inject: function () { return {}; }
    }, PageView);
  });

  ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register({
      name: 'shell.overlay',
      id: PANEL_ID,
      order: 900,
      label: function () { return '日历提醒'; }
    }, OverlayView);
  });

  /* 页面里点「⤢」或其他地方切形态时，保证浮卡/整页立刻换过来 */
  ctx.effect(function () {
    return subscribe(function () { conductor(); });
  });
}
