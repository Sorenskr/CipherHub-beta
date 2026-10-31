/**
 * CipherHub Beta · 前台交互逻辑 (app.js)
 *
 * 与在线表格（A1 姓名 | B1 关键词 | C1 模板）1:1 实时同步：
 *   - 模板固定顺序：番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2
 *   - 支持「速览与卡片视图」与「在线表格 1:1 视图（A1姓名/B1关键词/C1模板）」一键切换
 *   - 每次打开页面或切回标签页自动从绑定的在线表格拉取最新内容
 */
(function () {
  'use strict';

  var state = {
    q: '',
    template: '', // 选中的模板名，如 '番号'、'聊天' 等，'' 表示全部模板
    viewMode: 'discover', // 'discover' | 'sheet'
    limit: 50,
    entryLimit: 500,
    spotIdx: 0,
    spotTimer: null,
    spotItems: [],
    phTimer: null,
    phType: null,
    phIdx: 0,
    phCands: [],
    sugIdx: -1,
    sugItems: []
  };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlight(text, q) {
    var t = esc(text);
    if (!q) return t;
    var k = q.trim();
    if (!k) return t;
    var raw = String(text == null ? '' : text);
    var idx = raw.toLowerCase().indexOf(k.toLowerCase());
    if (idx < 0) return t;
    return esc(raw.slice(0, idx)) + '<mark>' + esc(raw.slice(idx, idx + k.length)) + '</mark>' + esc(raw.slice(idx + k.length));
  }

  function avatarColor(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'linear-gradient(135deg, hsl(' + h + ',68%,58%), hsl(' + ((h + 42) % 360) + ',70%,48%))';
  }

  function pico(name) {
    var map = {
      '番号': '番',
      '聊天': '聊',
      '对比': '对',
      '任务': '任',
      '新模版': '新',
      '备用': '备',
      '备用 2': '备2'
    };
    if (map[name]) return map[name];
    return String(name || '').slice(0, 1);
  }

  function maskName(n) {
    var s = String(n || '');
    if (!s) return '—';
    if (s.length <= 1) return s + '*';
    return s[0] + new Array(s.length).join('*');
  }

  function maskValue(v) {
    var s = String(v || '');
    if (!s) return '';
    if (s.length <= 3) return s[0] + new Array(Math.max(s.length, 2)).join('•');
    var head = s.slice(0, 2), tail = s.slice(-1);
    var mid = Math.min(s.length - 3, 4);
    return head + new Array(mid + 1).join('•') + tail;
  }

  function toast(msg, type) {
    var box = $('#toast');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast-item ' + (type || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { el.remove(); }, 260);
    }, 1800);
  }
  window.chToast = toast;

  function copyText(text, customMsg) {
    var msg = customMsg || ('已复制：' + text);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () { toast(msg, 'ok'); },
        function () { fallbackCopy(text, msg); }
      );
    } else {
      fallbackCopy(text, msg);
    }
  }

  function fallbackCopy(text, msg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(msg, 'ok');
    } catch (e) {
      toast('复制失败，请手动选择复制', 'err');
    }
    ta.remove();
  }

  function shuffle(a) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 背景动效 ---------- */
  function initBackground() {
    var box = $('#bgDots');
    if (!box) return;
    var colors = ['#7c5cff', '#3ea6ff', '#ff5c8a', '#00c8b4', '#ffb020'];
    var n = window.innerWidth < 700 ? 12 : 20;
    var html = '';
    for (var i = 0; i < n; i++) {
      var s = (2 + Math.random() * 4).toFixed(1);
      var dur = (15 + Math.random() * 18).toFixed(1);
      var delay = '-' + (Math.random() * 24).toFixed(1);
      var dx = ((Math.random() * 90 - 45) | 0);
      var left = (Math.random() * 100).toFixed(2);
      html += '<i style="--s:' + s + 'px;--c:' + colors[i % colors.length] + ';left:' + left +
        '%;animation-duration:' + dur + 's;animation-delay:' + delay + 's;--dx:' + dx + 'px"></i>';
    }
    box.innerHTML = html;
  }

  /* ---------- 主题 ---------- */
  function initTheme() {
    var t = localStorage.getItem('ch_theme');
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    var btn = $('#themeBtn');
    if (btn) {
      btn.onclick = function () {
        var cur = document.documentElement.getAttribute('data-theme');
        var next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('ch_theme', next);
      };
    }
  }

  /* ---------- Logo 切换 ---------- */
  function setupLogo(model) {
    var logos = (model.settings && model.settings.logos) || [];
    logos = logos.filter(Boolean);
    var box = $('#logoBox');
    var img = $('#brandLogo');
    var btn = $('#logoBtn');
    if (!logos.length || !box || !img) {
      if (box) box.textContent = '#';
      if (btn) btn.style.display = 'none';
      return;
    }
    var saved = parseInt(localStorage.getItem('ch_logo'), 10);
    var idx = (isNaN(saved) || saved < 0 || saved >= logos.length) ? 0 : saved;

    function paint(i) {
      idx = ((i % logos.length) + logos.length) % logos.length;
      img.onerror = function () {
        img.style.display = 'none';
        box.textContent = '#';
      };
      img.onload = function () {
        img.style.display = 'block';
      };
      img.src = logos[idx];
      localStorage.setItem('ch_logo', String(idx));
      if (btn) btn.title = '切换 Logo (' + (idx + 1) + '/' + logos.length + ')';
    }

    paint(idx);
    if (btn) {
      btn.style.display = logos.length < 2 ? 'none' : '';
      btn.onclick = function () {
        paint(idx + 1);
        toast('已切换 Logo', 'ok');
      };
    }
  }

  /* ---------- 在线表格同步状态条（前台静默同步，不向访客暴露表格状态栏） ---------- */
  function renderSyncBar() {
    var bar = $('#syncBar');
    if (bar) bar.style.display = 'none';
  }

  /* ---------- 搜索框占位轮播 ---------- */
  function buildPlaceholders(model) {
    var out = [];
    var sampleRows = shuffle(model.rows).slice(0, 6);
    sampleRows.forEach(function (r) {
      out.push('试着输入「' + r.keyword + '」查归属人');
    });
    var samplePeople = shuffle(model.people).slice(0, 3);
    samplePeople.forEach(function (p) {
      out.push('输入姓名「' + p.name + '」查看名下全部暗号');
    });
    out.push('输入姓名或关键词，秒查专属归属人');
    return shuffle(out);
  }

  function typePlaceholder(text) {
    var input = $('#q');
    if (!input) return;
    clearInterval(state.phType);
    var k = 0;
    input.setAttribute('placeholder', '');
    state.phType = setInterval(function () {
      k++;
      input.setAttribute('placeholder', text.slice(0, k));
      if (k >= text.length) clearInterval(state.phType);
    }, 45);
  }

  function startPlaceholder() {
    var input = $('#q');
    if (!input || !state.phCands.length) return;
    clearInterval(state.phTimer);
    state.phIdx = Math.floor(Math.random() * state.phCands.length);
    typePlaceholder(state.phCands[state.phIdx]);
    state.phTimer = setInterval(function () {
      if (input.value || document.activeElement === input) return;
      state.phIdx = (state.phIdx + 1) % state.phCands.length;
      typePlaceholder(state.phCands[state.phIdx]);
    }, 5000);
  }

  function stopPlaceholder() {
    clearInterval(state.phTimer);
    clearInterval(state.phType);
  }

  /* ---------- 分类筛选按钮行 ---------- */
  function renderFilters(model) {
    var html = '<button class="chip' + (state.template ? '' : ' on') + '" data-tpl="">全部分类 <span class="cnt">' + model.rows.length + '</span></button>';
    model.templates.forEach(function (t) {
      html += '<button class="chip' + (state.template === t.name ? ' on' : '') + '" data-tpl="' + esc(t.name) + '">' +
        '<span class="pico" style="background:' + esc(t.color) + '">' + esc(pico(t.name)) + '</span>' +
        esc(t.name) + '<span class="cnt">' + (t.count || 0) + '</span></button>';
    });
    var box = $('#platFilter');
    if (!box) return;
    box.innerHTML = html;

    box.querySelectorAll('.chip').forEach(function (el) {
      el.onclick = function () {
        var clicked = el.getAttribute('data-tpl') || '';
        state.template = state.template === clicked ? '' : clicked;
        state.limit = 50;
        refreshAllViews();
      };
    });
  }

  /* ---------- 统计条 ---------- */
  function renderStats(model) {
    var cards = [
      { n: model.stats.people,    t: '归属成员' },
      { n: model.stats.entries,   t: '暗号 / 关键词' },
      { n: model.stats.templates, t: '所属分类' },
      { n: model.source.indexOf('cloud') === 0 ? '实时在线' : '本地就绪', t: '数据状态', isText: true }
    ];
    var box = $('#stats');
    if (box) {
      box.innerHTML = cards.map(function (c) {
        return '<div class="stat"><b>' + esc(c.n) + '</b><span>' + esc(c.t) + '</span></div>';
      }).join('');
    }
    var up = $('#updatedAt');
    if (up && model.updatedAt) {
      up.textContent = '数据最近更新：' + new Date(model.updatedAt).toLocaleString('zh-CN');
    }
  }

  /* ---------- 速览：分类矩阵 ---------- */
  function renderMatrix(model) {
    var tpls = model.templates;
    var max = 1;
    tpls.forEach(function (t) { if ((t.count || 0) > max) max = t.count; });

    var box = $('#matrix');
    if (!box) return;
    box.innerHTML = tpls.map(function (t) {
      var n = t.count || 0;
      var rel = max ? Math.max((n / max * 100), n > 0 ? 6 : 0) : 0;
      return '<div class="mx' + (state.template === t.name ? ' on' : '') + '" data-tpl="' + esc(t.name) + '" style="--pc:' + esc(t.color) + '">' +
        '<div class="top">' +
          '<span class="ico" style="background:' + esc(t.color) + '">' + esc(pico(t.name)) + '</span>' +
          '<span class="nm">' + esc(t.name) + '</span>' +
        '</div>' +
        '<div class="nums"><b>' + n + '</b><small>条</small></div>' +
        '<div class="bar"><i style="width:' + rel.toFixed(1) + '%"></i></div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('.mx').forEach(function (el) {
      el.onclick = function () {
        var clicked = el.getAttribute('data-tpl') || '';
        state.template = state.template === clicked ? '' : clicked;
        refreshAllViews();
      };
    });

    var note = $('#discoverNote');
    if (note) {
      note.textContent = state.template
        ? '已聚焦「' + state.template + '」'
        : '点击任意分类查看随机样本';
    }
  }

  /* ---------- 速览：滚动带 + 聚焦卡 + 样本墙 ---------- */
  function renderDiscoverSamples(model) {
    var pool = model.entries.filter(function (e) {
      if (state.template && e.template !== state.template) return false;
      return true;
    });
    var picked = shuffle(pool).slice(0, 14).map(function (e) {
      return {
        rowNumber: e.rowNumber,
        template: e.template,
        color: e.color,
        maskedValue: maskValue(e.keyword),
        maskedName: maskName(e.name)
      };
    });

    // 滚动带
    var mq = $('#mqTrack');
    if (mq) {
      if (!picked.length) {
        mq.innerHTML = '';
      } else {
        var one = picked.map(function (it) {
          return '<span class="mq-item" style="--pc:' + esc(it.color) + '">' +
            '<span class="d"></span><span class="v">' + esc(it.maskedValue) + '</span>' +
            '<span class="p">' + esc(it.template) + ' · 归属 ' + esc(it.maskedName) + '</span></span>';
        }).join('');
        mq.innerHTML = one + one;
      }
    }

    // 聚焦卡
    startSpot(picked.slice(0, 6));

    // 预览墙
    var pvBox = $('#previewBox');
    if (pvBox) {
      var show = Boolean(state.template);
      pvBox.style.display = show ? '' : 'none';
      if (show) {
        $('#pvTitle').textContent = state.template + ' · 随机样本';
        $('#pvNote').textContent = '共 ' + pool.length + ' 条，以下为随机抽取的脱敏样本';
        $('#pvGrid').innerHTML = picked.slice(0, 12).map(function (it, idx) {
          return '<div class="pv" style="--pc:' + esc(it.color) + ';animation-delay:' + (idx * 40) + 'ms">' +
            '<div class="t"><span class="d"></span>' + esc(it.template) + '</div>' +
            '<div class="v">' + esc(it.maskedValue) + '</div>' +
            '<div class="w">归属人：' + esc(it.maskedName) + '</div>' +
          '</div>';
        }).join('');
      }
    }
  }

  function startSpot(items) {
    clearInterval(state.spotTimer);
    var body = $('#spotBody'), dots = $('#spotDots');
    if (!body || !dots) return;
    if (!items || !items.length) {
      body.innerHTML = '<div class="muted tiny">当前分类暂无记录</div>';
      dots.innerHTML = '';
      return;
    }
    state.spotItems = items;
    state.spotIdx = 0;
    drawSpot(0);
    state.spotTimer = setInterval(function () {
      drawSpot((state.spotIdx + 1) % state.spotItems.length);
    }, 4200);
    dots.innerHTML = items.map(function (_, i) {
      return '<b data-i="' + i + '"' + (i === 0 ? ' class="on"' : '') + '></b>';
    }).join('');
    dots.querySelectorAll('b').forEach(function (b) {
      b.onclick = function () { drawSpot(Number(b.getAttribute('data-i') || 0)); };
    });
  }

  function drawSpot(i) {
    var items = state.spotItems || [];
    if (!items.length) return;
    state.spotIdx = i;
    var it = items[i];
    var body = $('#spotBody');
    if (body) {
      body.innerHTML =
        '<div class="spot-item" style="--pc:' + esc(it.color) + '">' +
          '<div class="spot-plat"><span class="ico">' + esc(pico(it.template)) + '</span>' +
            '<b>' + esc(it.template) + '</b>' +
            '<span class="tag">暗号</span></div>' +
          '<div class="spot-code">' + esc(it.maskedValue) + '</div>' +
          '<div class="spot-who">归属人：' + esc(it.maskedName) + '</div>' +
        '</div>';
    }
    var dots = $('#spotDots');
    if (dots) {
      Array.prototype.forEach.call(dots.children, function (d, k) {
        d.classList.toggle('on', k === i);
      });
    }
  }

  /* ---------- 归属人全量明细视图 ---------- */
  function renderSheetOneToOneView(model) {
    var sec = $('#sheetViewSec');
    if (!sec) return;
    var q = state.q.trim().toLowerCase();
    var tplFilter = state.template;

    var filtered = model.rows.filter(function (r) {
      if (tplFilter && r.template !== tplFilter) return false;
      if (q) {
        var matchName = r.name.toLowerCase().indexOf(q) >= 0;
        var matchKw   = r.keyword.toLowerCase().indexOf(q) >= 0;
        var matchTpl  = r.template.toLowerCase().indexOf(q) >= 0;
        if (!matchName && !matchKw && !matchTpl) return false;
      }
      return true;
    });

    var colorMap = {};
    model.templates.forEach(function (t) { colorMap[t.name] = t.color; });

    $('#sheetViewCount').textContent = '共 ' + filtered.length + ' 条记录';

    var tbody = $('#sheetViewBody');
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:36px;color:var(--text-mute)">没有找到匹配的记录</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.slice(0, state.entryLimit).map(function (r, idx) {
      var c = colorMap[r.template] || '#7c5cff';
      return '<tr>' +
        '<td class="mono muted" style="width:76px">#' + (idx + 1) + '</td>' +
        '<td><b style="cursor:pointer" data-goto="' + esc(r.name) + '" title="点击查看该归属人全部暗号">' + highlight(r.name, state.q) + '</b></td>' +
        '<td class="mono"><span class="code" data-copy="' + esc(r.keyword) + '" title="点击复制关键词">' + highlight(r.keyword, state.q) + '</span></td>' +
        '<td><span class="tag"><span style="width:8px;height:8px;border-radius:50%;background:' + esc(c) + ';display:inline-block"></span>' + highlight(r.template, state.q) + '</span></td>' +
        '<td style="width:130px"><div class="ops">' +
          '<button class="btn sm ghost" data-copy="' + esc(r.keyword) + '">复制</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    bindResultEvents(sec);
  }

  /* ---------- 搜索结果（归属人卡片 + 匹配明细） ---------- */
  function personCard(p, q, tplFilter, colorMap) {
    var groups = {};
    var entries = p.entries.filter(function (e) {
      return !tplFilter || e.template === tplFilter;
    });

    entries.forEach(function (e) {
      var t = e.template;
      if (!groups[t]) {
        groups[t] = {
          name: t,
          color: colorMap[t] || '#7c5cff',
          order: window.CHStore.getTemplateOrderIndex(t),
          list: []
        };
      }
      groups[t].list.push(e);
    });

    var keys = Object.keys(groups).sort(function (a, b) {
      return groups[a].order - groups[b].order;
    });

    var body = keys.map(function (k) {
      var g = groups[k];
      return '<div class="plat">' +
        '<div class="label"><span class="pico" style="background:' + esc(g.color) + '">' + esc(pico(g.name)) + '</span>' +
        esc(g.name) + '<span class="cnt">· ' + g.list.length + '</span></div>' +
        '<div class="chips">' + g.list.map(function (e) {
          var hit = q && e.keyword.toLowerCase().indexOf(q.toLowerCase()) >= 0;
          return '<span class="code' + (hit ? ' hit' : '') + '" data-copy="' + esc(e.keyword) + '" title="点击复制">' +
            highlight(e.keyword, q) + '</span>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');

    return '<article class="person">' +
      '<div class="head">' +
        '<div class="avatar" style="background:' + avatarColor(p.name) + '">' + esc(p.name.slice(0, 1)) + '</div>' +
        '<div><div class="name">' + highlight(p.name, q) + '</div>' +
          '<div class="sub"><span class="tag">归属人</span><span class="tag">共 ' + entries.length + ' 条</span></div></div>' +
        '<button class="btn sm ghost copy-all" data-copyall="' + esc(p.name) + '">复制全部</button>' +
      '</div>' +
      (body || '<div class="tiny muted">暂无记录</div>') +
    '</article>';
  }

  function entryRow(e, q) {
    return '<div class="entry">' +
      '<span class="val">' + highlight(e.keyword, q) + '</span>' +
      '<span class="who">归属人：<b data-goto="' + esc(e.name) + '">' + highlight(e.name, q) + '</b></span>' +
      '<span class="right">' +
        '<span class="tag"><span class="pico" style="background:' + esc(e.color || '#7c5cff') + ';width:15px;height:15px;border-radius:4px;display:inline-grid;place-items:center;font-size:9px;color:#fff">' + esc(pico(e.template)) + '</span>' + highlight(e.template, q) + '</span>' +
        '<button class="btn sm ghost" data-copy="' + esc(e.keyword) + '">复制</button>' +
      '</span>' +
    '</div>';
  }

  function renderSearchResults(model) {
    var q = state.q.trim();
    var ql = q.toLowerCase();
    var tplFilter = state.template;
    var box = $('#results');
    if (!box) return;

    var colorMap = {};
    model.templates.forEach(function (t) { colorMap[t.name] = t.color; });

    var matchedEntries = model.entries.filter(function (e) {
      if (tplFilter && e.template !== tplFilter) return false;
      if (!ql) return true;
      return e.name.toLowerCase().indexOf(ql) >= 0 ||
             e.keyword.toLowerCase().indexOf(ql) >= 0 ||
             e.template.toLowerCase().indexOf(ql) >= 0;
    });

    var personNamesSet = {};
    matchedEntries.forEach(function (e) { personNamesSet[e.name] = true; });
    var matchedPeople = model.people.filter(function (p) {
      return personNamesSet[p.name] || (ql && p.name.toLowerCase().indexOf(ql) >= 0);
    });

    if (!matchedPeople.length && !matchedEntries.length) {
      box.innerHTML = '<div class="empty"><div class="big">🔍</div>没有找到与「' + esc(q) + '」相关的归属人或关键词<br>' +
        '<span class="tiny">换个关键词试试，或联系管理员添加</span></div>';
      return;
    }

    var html = '';
    if (matchedPeople.length) {
      html += '<div class="section-head"><h2>匹配归属人</h2><span class="n">共 ' + matchedPeople.length + ' 人</span></div>';
      html += '<div class="people-grid">' + matchedPeople.slice(0, state.limit).map(function (p) {
        return personCard(p, q, tplFilter, colorMap);
      }).join('') + '</div>';
    }

    if (matchedEntries.length) {
      html += '<div class="section-head"><h2>匹配暗号 / 关键词</h2><span class="n">共 ' + matchedEntries.length + ' 条</span></div>';
      html += '<div class="entry-list">' + matchedEntries.slice(0, state.entryLimit).map(function (e) {
        return entryRow(e, q);
      }).join('') + '</div>';
    }

    box.innerHTML = html;
    bindResultEvents(box);
  }

  function bindResultEvents(root) {
    (root || document).querySelectorAll('[data-copy]').forEach(function (el) {
      el.onclick = function (ev) {
        ev.stopPropagation();
        copyText(el.getAttribute('data-copy'));
      };
    });
    (root || document).querySelectorAll('[data-goto]').forEach(function (el) {
      el.onclick = function () {
        state.q = el.getAttribute('data-goto') || '';
        $('#q').value = state.q;
        $('#searchbox').classList.toggle('has-value', Boolean(state.q));
        refreshAllViews();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    });
    (root || document).querySelectorAll('[data-copyall]').forEach(function (el) {
      el.onclick = function () {
        var card = el.closest('.person');
        if (!card) return;
        var name = card.querySelector('.name').textContent;
        var lines = [name];
        card.querySelectorAll('.plat').forEach(function (pl) {
          var label = pl.querySelector('.label').textContent.split('·')[0].trim();
          var codes = [];
          pl.querySelectorAll('.code').forEach(function (c) {
            codes.push(c.textContent.trim());
          });
          lines.push(label + '：' + codes.join('、'));
        });
        copyText(lines.join('\n'), '已复制 ' + name + ' 的全部关键词');
      };
    });
  }

  /* ---------- 搜索建议下拉 ---------- */
  function renderSuggest(model) {
    var box = $('#suggest');
    var q = state.q.trim().toLowerCase();
    if (!box || !q) {
      if (box) box.classList.remove('show');
      return;
    }
    var peopleHits = model.people.filter(function (p) {
      return p.name.toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6);

    var kwHits = [];
    var seen = {};
    model.entries.forEach(function (e) {
      if (kwHits.length >= 8) return;
      if (e.keyword.toLowerCase().indexOf(q) >= 0 && !seen[e.keyword]) {
        seen[e.keyword] = true;
        kwHits.push(e);
      }
    });

    var html = '';
    state.sugItems = [];
    if (peopleHits.length) {
      html += '<div class="grp">归属人</div>';
      peopleHits.forEach(function (p) {
        state.sugItems.push(p.name);
        html += '<div class="item" data-v="' + esc(p.name) + '"><span>👤</span><span>' + highlight(p.name, state.q) + '</span>' +
          '<span class="meta">' + p.entries.length + ' 条关键词</span></div>';
      });
    }
    if (kwHits.length) {
      html += '<div class="grp">暗号 / 关键词</div>';
      kwHits.forEach(function (e) {
        state.sugItems.push(e.keyword);
        html += '<div class="item" data-v="' + esc(e.keyword) + '"><span>#</span><span class="val">' + highlight(e.keyword, state.q) + '</span>' +
          '<span class="meta">归属：' + esc(e.name) + ' · ' + esc(e.template) + '</span></div>';
      });
    }
    if (!html) html = '<div class="empty">无匹配建议</div>';
    box.innerHTML = html;
    box.classList.add('show');
    state.sugIdx = -1;

    box.querySelectorAll('.item').forEach(function (el) {
      el.onmousedown = function (ev) {
        ev.preventDefault();
        pickSuggest(el.getAttribute('data-v') || '');
      };
    });
  }

  function pickSuggest(v) {
    state.q = v;
    $('#q').value = v;
    $('#searchbox').classList.toggle('has-value', Boolean(v));
    $('#suggest').classList.remove('show');
    stopPlaceholder();
    refreshAllViews();
  }

  /* ---------- 问题反馈 ---------- */
  function renderFeedback(model) {
    var s = model.settings || {};
    var fb = s.feedback || {};
    var contacts = s.contacts || [];

    $('#fbTitle').textContent = fb.title || '问题反馈';
    $('#fbDesc').textContent = fb.desc || '';
    $('#fbDesc').style.display = fb.desc ? '' : 'none';

    var box = $('#fbContacts');
    if (contacts.length) {
      box.style.display = '';
      $('#fbEmpty').style.display = 'none';
      box.innerHTML = contacts.map(function (c) {
        return '<div class="ct">' +
          '<span class="ty">' + esc(c.type || '联系') + '</span>' +
          '<span class="vl">' + esc(c.value) + (c.label ? ' <span class="tiny muted">· ' + esc(c.label) + '</span>' : '') + '</span>' +
          '<button class="cp" data-copy="' + esc(c.value) + '" title="复制">复制</button>' +
        '</div>';
      }).join('');
      box.querySelectorAll('[data-copy]').forEach(function (el) {
        el.onclick = function () { copyText(el.getAttribute('data-copy')); };
      });
    } else {
      box.style.display = 'none';
      $('#fbEmpty').style.display = '';
    }

    var enable = fb.enableForm !== false;
    $('#fbForm').style.display = enable ? '' : 'none';
    $('#fbFab').style.display = enable ? '' : 'none';
    $('#fbSub').textContent = enable ? '查不到、关键词有误、需要新增 —— 都可以告诉我们' : '管理员已关闭留言';
  }

  function bindFeedback() {
    var fab = $('#fbFab');
    if (fab) {
      fab.onclick = function () {
        $('#feedback').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }
    var form = $('#fbForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('#fbMsg').value.trim();
      if (!msg) { toast('请填写反馈内容', 'err'); return; }
      var payload = {
        action: 'FEEDBACK',
        name: $('#fbName').value.trim(),
        contact: $('#fbContact').value.trim(),
        message: msg,
        createdAt: new Date().toISOString()
      };
      var btn = $('#fbSubmit');
      btn.disabled = true;
      btn.textContent = '提交中…';

      var cfg = window.CHStore.getBindConfig();
      var saveLocalFb = function () {
        try {
          var list = JSON.parse(localStorage.getItem('ch_beta_feedbacks') || '[]');
          list.unshift(payload);
          localStorage.setItem('ch_beta_feedbacks', JSON.stringify(list.slice(0, 200)));
        } catch (err) {}
      };

      var p = cfg.appsScriptUrl
        ? fetch(cfg.appsScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          }).then(function (r) { return r.json(); })
        : Promise.resolve({ ok: true });

      p.then(function () {
        saveLocalFb();
        $('#fbMsg').value = '';
        toast('已提交反馈，感谢！', 'ok');
      }).catch(function () {
        saveLocalFb();
        $('#fbMsg').value = '';
        toast('已记录反馈！', 'ok');
      }).then(function () {
        btn.disabled = false;
        btn.textContent = '提交反馈';
      });
    });
  }

  /* ---------- 视图切换与总刷新 ---------- */
  function refreshAllViews() {
    var model = window.CHStore.getModel();
    document.title = (model.settings && model.settings.siteName) || '暗号查询中心 Beta';
    $('#siteName').textContent = (model.settings && model.settings.siteName) || '暗号查询中心 Beta';
    if (model.settings && model.settings.subtitle) {
      var subText = model.settings.subtitle;
      if (subText.indexOf('对应模板') >= 0 || subText.indexOf('在线表格实时联动') >= 0) {
        subText = '支持按姓名正查名下全部关键词，或输入暗号关键词反查归属人';
      }
      $('#subtitle').textContent = subText;
    }

    renderSyncBar(model);
    renderFilters(model);
    renderStats(model);
    renderFeedback(model);

    var hasQ = Boolean(state.q.trim());
    var isSheetMode = state.viewMode === 'sheet';

    $$('#viewSwitch button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.viewMode);
    });

    if (isSheetMode) {
      $('#discover').style.display = 'none';
      $('#results').style.display = 'none';
      $('#sheetViewSec').style.display = '';
      renderSheetOneToOneView(model);
    } else {
      $('#sheetViewSec').style.display = 'none';
      if (hasQ) {
        $('#discover').style.display = 'none';
        $('#results').style.display = '';
        renderSearchResults(model);
      } else {
        $('#discover').style.display = '';
        $('#results').style.display = 'none';
        renderMatrix(model);
        renderDiscoverSamples(model);
      }
    }
  }

  function bindEvents() {
    var input = $('#q');
    input.addEventListener('input', function () {
      state.q = input.value;
      state.limit = 50;
      $('#searchbox').classList.toggle('has-value', Boolean(input.value));
      if (input.value) stopPlaceholder();
      renderSuggest(window.CHStore.getModel());
      refreshAllViews();
    });
    input.addEventListener('focus', function () {
      if (state.q.trim()) renderSuggest(window.CHStore.getModel());
    });
    input.addEventListener('blur', function () {
      if (!input.value) startPlaceholder();
    });
    input.addEventListener('keydown', function (e) {
      var box = $('#suggest');
      if (!box.classList.contains('show')) return;
      var items = box.querySelectorAll('.item');
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        state.sugIdx += e.key === 'ArrowDown' ? 1 : -1;
        if (state.sugIdx < 0) state.sugIdx = items.length - 1;
        if (state.sugIdx >= items.length) state.sugIdx = 0;
        items.forEach(function (el, i) { el.classList.toggle('active', i === state.sugIdx); });
      } else if (e.key === 'Enter' && state.sugIdx >= 0) {
        e.preventDefault();
        pickSuggest(items[state.sugIdx].getAttribute('data-v') || '');
      } else if (e.key === 'Escape') {
        box.classList.remove('show');
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.searchbox')) $('#suggest').classList.remove('show');
    });

    $('#clearBtn').onclick = function () {
      input.value = '';
      state.q = '';
      $('#searchbox').classList.remove('has-value');
      $('#suggest').classList.remove('show');
      refreshAllViews();
      startPlaceholder();
      input.focus();
    };

    $$('#viewSwitch button').forEach(function (btn) {
      btn.onclick = function () {
        state.viewMode = btn.getAttribute('data-view') || 'discover';
        refreshAllViews();
      };
    });

    var navSheet = $('#navSheetView');
    if (navSheet) {
      navSheet.onclick = function (e) {
        e.preventDefault();
        state.viewMode = state.viewMode === 'sheet' ? 'discover' : 'sheet';
        refreshAllViews();
      };
    }

    var navDiscover = $('#navDiscover');
    if (navDiscover) {
      navDiscover.onclick = function (e) {
        e.preventDefault();
        input.value = '';
        state.q = '';
        state.viewMode = 'discover';
        $('#searchbox').classList.remove('has-value');
        refreshAllViews();
      };
    }

    var btnCopySheet = $('#copySheetAllBtn');
    if (btnCopySheet) {
      btnCopySheet.onclick = function () {
        var model = window.CHStore.getModel();
        var rows = model.rows.filter(function (r) {
          if (state.template && r.template !== state.template) return false;
          if (state.q.trim()) {
            var k = state.q.trim().toLowerCase();
            return r.name.toLowerCase().indexOf(k) >= 0 ||
                   r.keyword.toLowerCase().indexOf(k) >= 0 ||
                   r.template.toLowerCase().indexOf(k) >= 0;
          }
          return true;
        });
        var lines = ['姓名\t关键词\t模板'];
        rows.forEach(function (r) {
          lines.push(r.name + '\t' + r.keyword + '\t' + r.template);
        });
        copyText(lines.join('\n'), '已复制 ' + rows.length + ' 行表格数据（可直接粘贴到在线表格 A1）');
      };
    }

    var syncPullBtn = $('#syncPullBtn');
    if (syncPullBtn) {
      syncPullBtn.onclick = function () {
        window.CHStore.pullFromOnlineSheet()
          .then(function (m) {
            toast('已从在线表格实时同步 ' + m.rows.length + ' 行数据', 'ok');
          })
          .catch(function (err) {
            toast('同步失败：' + err.message, 'err');
          });
      };
    }

    var openBindBtn = $('#openBindBtn');
    if (openBindBtn) {
      openBindBtn.onclick = function () {
        if (window.CHAdmin) window.CHAdmin.open('bind');
      };
    }

    var topAdminBtn = $('#topAdminBtn');
    if (topAdminBtn) {
      topAdminBtn.onclick = function () {
        if (window.CHAdmin) window.CHAdmin.open('bind');
      };
    }

    $('#shuffleAll').onclick = function () {
      renderDiscoverSamples(window.CHStore.getModel());
      toast('已换一批随机样本', 'ok');
    };

    $('#spotMore').onclick = function () {
      if (state.spotItems.length) {
        drawSpot((state.spotIdx + 1) % state.spotItems.length);
      }
    };

    // 连点左上角 Logo 5 次进入后台
    var logoBox = $('#logoBox');
    if (logoBox) {
      var clickCount = 0, clickTimer = null;
      logoBox.style.cursor = 'pointer';
      logoBox.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        clickCount++;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(function () { clickCount = 0; }, 2500);
        logoBox.style.transform = 'scale(0.88)';
        setTimeout(function () { logoBox.style.transform = ''; }, 130);
        if (clickCount >= 5) {
          clickCount = 0;
          if (window.CHAdmin) window.CHAdmin.open('bind');
        } else if (clickCount >= 3) {
          toast('再点 ' + (5 - clickCount) + ' 次进入后台管理');
        }
      });
    }
  }

  /* ---------- 初始化 ---------- */
  initBackground();
  initTheme();

  var initModel = window.CHStore.getModel();
  setupLogo(initModel);
  state.phCands = buildPlaceholders(initModel);
  bindEvents();
  bindFeedback();
  refreshAllViews();
  startPlaceholder();

  // 订阅数据层变更（无论是从在线表格拉取完成，还是在后台修改，前台自动同步刷新）
  window.CHStore.subscribe(function (newModel) {
    setupLogo(newModel);
    state.phCands = buildPlaceholders(newModel);
    refreshAllViews();
  });

  // 页面加载时自动从绑定的在线表格拉取最新数据
  window.CHStore.pullFromOnlineSheet({ silent: true }).catch(function () {});
})();

