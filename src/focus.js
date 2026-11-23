/* Study plan and activity log. Mounted inside the coach, with its existing backup and storage. */
var FOCUS = (function () {
  'use strict';

  var lead = [
    '数据库 · 做一组 SQL 题，订正错误查询',
    '数据结构 · 手写一道树或图题并分析复杂度',
    '计基 II · 从书面作业挑两道错题重做',
    '线代 · 限时做一组当前进度内的题',
    '软工 II · 闭卷写一页知识框架，用课件订正',
    '数据库 · 复习范式、事务或索引，做一道综合题'
  ];
  var cet = [
    '六级 · 限时练听力并记录错因',
    '六级 · 限时做阅读并记录正确数和用时',
    '六级 · 写一篇作文或完成一篇翻译，再对照修改'
  ];
  var sprint = [
    '数据库 · 限时做一组题，写下本周最常见的错因',
    '数据结构 · 做一道综合题并重做一道错题',
    '习概 · 合上资料复述一个专题的框架',
    '线代 · 做一组题并核对计算和证明步骤',
    '软工 II · 用一个例子复述本周的概念',
    '计基 II · 重做作业中的易错题并复盘'
  ];
  var winter = [
    '跑通标注任务的 Spring Boot 接口并记录请求与响应',
    '用 MySQL 保存任务，验证约束和查询结果',
    '给任务接口补一个正常用例和两个异常用例',
    '沿一个请求追到数据库，画出模块和数据流',
    '完善项目运行说明，把亲手做过的一项写进简历',
    '核对两个实习岗位的到岗和年级要求，更新投递记录'
  ];
  var css = [
    '.ddc-focus-block{border:1px solid var(--dsw-alias-border-default,#7d899644);border-radius:8px;padding:9px 10px;margin:0 0 8px}',
    '.ddc-focus-block h3{font-size:13px;margin:0 0 6px}.ddc-focus-block p{margin:5px 0}',
    '.ddc-focus-row,.ddc-focus-controls{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:5px 0}',
    '.ddc-focus-row label{flex:1;min-width:135px}.ddc-focus-block input{color:inherit}',
    '.ddc-focus-block input[type=number],.ddc-focus-block input[type=date]{background:transparent;border:1px solid var(--dsw-alias-border-default,#7d899677);border-radius:4px;padding:3px}',
    '.ddc-focus-block input[type=number]{width:52px}.ddc-focus-block summary{cursor:pointer}.ddc-focus-block ul{padding-left:18px;margin:5px 0}'
  ].join('\n');
  var pane, options, dates, status, busy, request;

  function today() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function shift(key, days) {
    return new Date(Date.parse(key + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }
  function weekday(key) { return (new Date(key + 'T00:00:00Z').getUTCDay() + 6) % 7; }

  function planFor(key, cetRegistered) {
    var n = weekday(key);
    if (key <= '2026-12-12') return {
      name: '期末与六级',
      tasks: [lead[n % lead.length], cetRegistered && key === '2026-12-12' ? '六级 · 带齐证件，参加下午笔试' :
        n === 5 ? '六级 · 完成一套限时真题并复盘' : cet[n % cet.length]]
    };
    if (key < '2026-12-29') return {
      name: '期末冲刺',
      tasks: [sprint[n % 2], sprint[2 + n % 4]]
    };
    if (key <= '2027-01-09') {
      var exams = dates ? dates.finals : [];
      var remaining = exams.filter(function (x) { return x.date >= key; });
      var first = remaining[0];
      var second = remaining[1];
      var subject = first ? first.title : '最近一门考试';
      return { name: '期末考试周', tasks: [
        first && first.date === key ? '参加考试 · ' + subject : subject + ' · 限时练习',
        second ? second.title + ' · 回做错题或默写提纲' : '计基 II · 重做错题，整理最后的易错点'
      ] };
    }
    return { name: '寒假 · 技术、竞赛与实习', tasks: [winter[n % winter.length], '蓝桥杯 · 用 Java 做一道真题并复盘'] };
  }

  function currentDay(data, key) {
    var day = data.days[key];
    return day && day.tasks && typeof day.tasks === 'object' ? day : { tasks: {}, minutes: 0, run: false };
  }
  function writeDay(data, key) { return (data.days[key] = currentDay(data, key)); }
  function esc(x) { return options.escape(x); }
  function checked(x) { return x ? ' checked' : ''; }
  function runProgress(data, key) {
    var runs = Object.keys(data.days).filter(function (d) {
      return d <= key && data.days[d] && data.days[d].run === true;
    }).length;
    var remaining = data.target ? '还差 ' + Math.max(0, data.target - data.baseline - runs) + ' 次' : '可填写目标次数';
    return '校园跑 · 已记录 ' + runs + ' 次 · ' + remaining + (data.deadline ? ' · 截止 ' + data.deadline : '');
  }
  function taskRow(text, on, action, index) {
    return '<div class="ddc-focus-row"><label><input type="checkbox" data-focus="' + action + '" data-index="' + index + '"' +
      checked(on) + '> ' + esc(text) + '</label>' +
      (action === 'task' && !on ? '<button type="button" class="ddc-mini" data-focus="defer" data-index="' + index + '">移到本周</button>' : '') +
      '</div>';
  }

  function render() {
    if (!pane) return;
    var data = options.data();
    var key = today();
    pane.setAttribute('data-focus-day', key);
    var day = currentDay(data, key);
    var week = shift(key, -weekday(key));
    var weekState = data.weeks[week] || {};
    var phase = planFor(key, data.cet);
    var weekly = key <= '2026-12-12' ? ['复盘一套六级真题，找出最该练的两项', '核对蓝桥杯校内报名和指导老师'] :
      key <= '2027-01-09' ? ['检查最近三门考试的复习进度', '订正一组限时练习的错题'] :
        ['整理一次 Java 后端练习的可运行成果', '复盘本周真题与实习投递'];
    weekly.push('项目组测试 · 确认一个功能，执行用例并记录结果');
    var list = dates ? dates.finals.concat(data.cet ? [dates.cet] : [], data.contest ? [dates.contest] : [])
      .sort(function (a, b) { return a.date.localeCompare(b.date); }) : [];
    var next = list.filter(function (x) { return x.date >= key; })[0];
    var html = '<div class="ddc-focus-block"><h3>今天 · ' + esc(phase.name) + '</h3>' +
      (next ? '<p>最近日期 · ' + esc(next.date + ' ' + next.time + ' ' + next.title) + '</p>' : '');
    for (var i = 0; i < phase.tasks.length; i++) {
      if (day.tasks[i] === 'deferred') continue;
      html += taskRow(phase.tasks[i], day.tasks[i], 'task', i);
    }
    if (day.tasks[0] === 'deferred' && day.tasks[1] === 'deferred') html += '<p>今天的两项任务已移到本周。</p>';
    html += '</div><div class="ddc-focus-block"><h3 data-focus-minutes>运动 · ' + count(day.minutes, 1440) + ' / 30 分钟</h3>' +
      '<div class="ddc-focus-controls"><label>今日分钟 <input type="number" min="0" max="1440" data-focus="minutes" value="' +
      count(day.minutes, 1440) + '"></label><label><input type="checkbox" data-focus="run"' + checked(day.run) + '> 有效校园跑</label></div>' +
      '<p data-focus-runs>' + esc(runProgress(data, key)) + '</p><details><summary>校园跑设置</summary>' +
      '<div class="ddc-focus-controls"><label>目标次数 <input type="number" min="0" max="365" data-focus="target" value="' + (data.target || '') + '"></label>' +
      '<label>记录前已完成 <input type="number" min="0" max="365" data-focus="baseline" value="' + (data.baseline || '') + '"></label>' +
      '<label>截止日期 <input type="date" data-focus="deadline" value="' + esc(data.deadline || '') + '"></label></div></details></div>' +
      '<div class="ddc-focus-block"><h3>饮食习惯</h3>' +
      '<label data-focus-habit' + (data.habit ? '' : ' hidden') + '><input type="checkbox" data-focus="habitDone"' +
      checked(day.habitDone) + '> <span>' + esc(data.habit || '') + '</span></label>' +
      '<div class="ddc-focus-controls"><label>我的目标 <input type="text" maxlength="60" data-focus="habit" placeholder="例如把一杯含糖饮料换成水" value="' +
      esc(data.habit || '') + '"></label></div></div>';
    html += '<div class="ddc-focus-block"><h3>本周 · ' + week + ' 起</h3>';
    var weekKind = key <= '2026-12-12' ? 'cet-' : key <= '2027-01-09' ? 'final-' : 'winter-';
    for (var j = 0; j < weekly.length; j++) {
      var itemKey = j === weekly.length - 1 ? 'project' : weekKind + j;
      html += taskRow(weekly[j], weekState[itemKey], 'week', itemKey);
    }
    // Incomplete items from previous weeks stay visible until completed.
    Object.keys(data.backlog).sort().forEach(function (weekKey) {
      var tasks = data.backlog[weekKey];
      Object.keys(tasks).forEach(function (id) {
        if (weekKey === week || !tasks[id].done) {
          html += taskRow(tasks[id].text, tasks[id].done, 'backlog', weekKey + '/' + id);
        }
      });
    });
    html += '</div><div class="ddc-focus-block"><details><summary>考试和比赛日期</summary>' +
      '<div class="ddc-focus-controls"><label><input type="checkbox" data-focus="cet"' + checked(data.cet) + '> 已报名六级</label>' +
      '<label><input type="checkbox" data-focus="contest"' + checked(data.contest) + '> 跟踪蓝桥杯报名</label></div>' +
      (list.length ? '<ul>' + list.map(function (x) {
        return '<li>' + esc(x.date + ' ' + x.time + (x.end ? '–' + x.end : '') + ' ' + x.title) + '</li>';
      }).join('') + '</ul>' : '') +
      '<button type="button" class="ddc-mini" data-focus="import"' + (busy || !dates ? ' disabled' : '') + '> 导入到日历</button>' +
      '<p data-focus-status role="status">' + esc(status || '') + '</p></details></div>';
    var details = pane.querySelectorAll('details');
    var open = Array.prototype.map.call(details, function (el) { return el.open; });
    pane.innerHTML = html;
    var nextDetails = pane.querySelectorAll('details');
    for (var k = 0; k < nextDetails.length; k++) nextDetails[k].open = !!open[k];
  }

  function count(value, max) { return Math.min(max, Math.max(0, Math.floor(Number(value) || 0))); }

  function change(event) {
    var input = event.target;
    var action = input.getAttribute('data-focus');
    if (!action) return;
    var data = options.data();
    var key = pane.getAttribute('data-focus-day');
    var index = input.getAttribute('data-index');
    if (action === 'task') writeDay(data, key).tasks[index] = input.checked;
    else if (action === 'week') {
      var week = shift(key, -weekday(key));
      var weekState = data.weeks[week] || (data.weeks[week] = {});
      weekState[index] = input.checked;
    } else if (action === 'backlog') {
      var parts = index.split('/');
      data.backlog[parts[0]][parts[1]].done = input.checked;
    } else if (action === 'minutes') writeDay(data, key).minutes = count(input.value, 1440);
    else if (action === 'run') writeDay(data, key).run = input.checked;
    else if (action === 'habitDone') writeDay(data, key).habitDone = input.checked;
    else if (action === 'habit') {
      data.habit = input.value.trim().slice(0, 60);
      writeDay(data, key).habitDone = false;
    }
    else if (action === 'target' || action === 'baseline') data[action] = count(input.value, 365);
    else if (action === 'deadline') data.deadline = input.value;
    else if (action === 'cet' || action === 'contest') data[action] = input.checked;
    else return;
    options.save();
    if (input.type !== 'checkbox') {
      var day = currentDay(data, key);
      pane.querySelector('[data-focus-minutes]').textContent = '运动 · ' + count(day.minutes, 1440) + ' / 30 分钟';
      pane.querySelector('[data-focus-runs]').textContent = runProgress(data, key);
      var habit = pane.querySelector('[data-focus-habit]');
      habit.hidden = !data.habit;
      habit.querySelector('span').textContent = data.habit || '';
      habit.querySelector('input').checked = !!day.habitDone;
      input.value = (action === 'minutes' ? day.minutes : data[action]) || '';
      return;
    }
    render();
    var inputs = pane.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute('data-focus') === action && inputs[i].getAttribute('data-index') === index) {
        inputs[i].focus();
        break;
      }
    }
  }

  function click(event) {
    var action = event.target.getAttribute('data-focus');
    var data = options.data();
    if (action === 'defer') {
      var key = pane.getAttribute('data-focus-day');
      var index = event.target.getAttribute('data-index');
      var week = shift(key, -weekday(key));
      var backlog = data.backlog[week] || (data.backlog[week] = {});
      var id = key + '-' + index;
      backlog[id] = { text: planFor(key, data.cet).tasks[index], done: false };
      writeDay(data, key).tasks[index] = 'deferred';
      options.save();
      render();
      pane.querySelector('[data-focus="backlog"][data-index="' + week + '/' + id + '"]').focus();
      return;
    }
    if (action !== 'import' || busy) return;
    var active = pane;
    status = '正在导入…';
    busy = true;
    render();
    options.api.importDates({ cet: data.cet, contest: data.contest }).then(function (result) {
      if (active !== pane) return;
      status = '新增 ' + result.added + ' 项，已有 ' + result.existing + ' 项，已过期 ' + result.past + ' 项。';
    }, function (err) {
      if (active !== pane) return;
      status = '导入失败：' + err.message;
    }).then(function () {
      if (active !== pane) return;
      busy = false;
      render();
      pane.querySelector('[data-focus="import"]').focus();
    });
  }

  function refresh() {
    if (!pane || dates || request || !options.api) return;
    var active = pane;
    request = options.api.dates().then(function (result) {
      if (active !== pane) return;
      dates = result;
      status = '';
      render();
    }, function () {
      if (active !== pane) return;
      status = '暂时无法读取考试日期，重新打开「今天」可重试。';
      render();
    }).then(function () { if (active === pane) request = null; });
  }

  return {
    css: css,
    summary: function () {
      return '<b>期末、六级和寒假</b><br>至 12 月 12 日 · 期末复习与六级真题<br>' +
        '12 月 13 日–1 月 9 日 · 期末冲刺和考试<br>1 月 10 日起 · 后端项目、蓝桥杯和实习投递';
    },
    update: render,
    tick: function () { if (pane && pane.getAttribute('data-focus-day') !== today()) render(); },
    refresh: refresh,
    mount: function (node, opts) {
      pane = node;
      options = opts;
      pane.addEventListener('change', change);
      pane.addEventListener('click', click);
      render();
      refresh();
    },
    unmount: function () {
      if (!pane) return;
      pane.removeEventListener('change', change);
      pane.removeEventListener('click', click);
      pane = options = dates = request = null;
      busy = false;
      status = '';
    }
  };
})();
