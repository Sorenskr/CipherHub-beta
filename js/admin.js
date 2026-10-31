/**
 * CipherHub Beta · 内置后台管理逻辑 (admin.js)
 *
 * 核心能力：
 *   1. 在线表格绑定（支持 Google Apps Script Web App 双向读写 + Google Sheets 链接直连实时拉取）
 *   2. 一一对应总表管理（A1 姓名 | B1 关键词 | C1 模板），严格保持：
 *      【先放完「番号」表所有人，再放「聊天」表的，接着是对比、任务、新模版、备用、备用 2，不会乱】
 *   3. 成员聚合视图、Excel/表格直接复制粘贴批量导入、CSV/JSON 导出与站点设置
 */
(function () {
  'use strict';

  var OK_KEY = 'ch_beta_admin_ok';
  var mounted = false;

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

  function toast(msg, type) {
    var box = $('#admToast');
    if (!box) {
      if (window.chToast) window.chToast(msg, type);
      return;
    }
    var el = document.createElement('div');
    el.className = 'toast-item ' + (type || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, 2200);
  }

  function getPass() {
    var cfg = window.CHStore.getBindConfig();
    return cfg.adminToken || (window.CH_BETA_CONFIG && window.CH_BETA_CONFIG.adminPass) || 'admin123';
  }

  function ensureMounted() {
    if (mounted) return;
    mounted = true;
    bindEvents();
    window.CHStore.subscribe(function () {
      if (document.body.classList.contains('adm-on')) {
        renderAll();
      }
    });
  }

  function showGate(targetTab) {
    ensureMounted();
    $('#admGate').style.display = 'grid';
    $('#admRoot').style.display = 'none';
    $('#admGate').dataset.targetTab = targetTab || 'bind';
    document.body.classList.add('adm-on');
    setTimeout(function () {
      var p = $('#admGatePass');
      if (p) p.focus();
    }, 60);
  }

  function switchTab(tabName) {
    if (!tabName) return;
    $$('#admTabs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === tabName);
    });
    $$('#admRoot .panel').forEach(function (p) {
      p.classList.toggle('on', p.id === 'adm-panel-' + tabName);
    });
  }

  function showAdmin(targetTab) {
    $('#admGate').style.display = 'none';
    $('#admRoot').style.display = 'block';
    document.body.classList.add('adm-on');
    if (targetTab) switchTab(targetTab);
    renderAll();
    window.scrollTo(0, 0);
  }

  function exitAdmin() {
    document.body.classList.remove('adm-on');
    $('#admRoot').style.display = 'none';
    $('#admGate').style.display = 'none';
    window.scrollTo(0, 0);
  }

  function boot(targetTab) {
    ensureMounted();
    loadBindForm();
    loadSettingsForm();
    showAdmin(targetTab || 'bind');
  }

  window.CHAdmin = {
    open: function (targetTab) {
      if (localStorage.getItem(OK_KEY) === '1') {
        boot(targetTab);
        return;
      }
      showGate(targetTab);
    },
    isOpen: function () {
      return document.body.classList.contains('adm-on');
    }
  };

  /* ---------------- 渲染各面板 ---------------- */
  function fillTemplateSelects(model) {
    var opts = '<option value="">全部模板（按固定顺序）</option>' +
      model.templates.map(function (t) {
        return '<option value="' + esc(t.name) + '">' + esc(t.name) + ' (' + (t.count || 0) + ')</option>';
      }).join('');
    var rowFilter = $('#admRTpl');
    if (rowFilter) {
      var prev = rowFilter.value;
      rowFilter.innerHTML = opts;
      rowFilter.value = prev;
    }

    var bulkTpl = $('#admBTpl');
    if (bulkTpl) {
      var prevB = bulkTpl.value;
      bulkTpl.innerHTML = model.templates.map(function (t) {
        return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>';
      }).join('');
      if (prevB) bulkTpl.value = prevB;
    }
  }

  function renderAll() {
    var model = window.CHStore.getModel();
    fillTemplateSelects(model);
    renderBindOverview(model);
    renderRowsTable(model);
    renderPeopleTable(model);
  }

  function loadBindForm() {
    var cfg = window.CHStore.getBindConfig();
    $('#admCfgGasUrl').value = cfg.appsScriptUrl || '';
    $('#admCfgSheetUrl').value = cfg.sheetUrl || '';
    $('#admCfgSheetName').value = cfg.sheetName || '';
    $('#admCfgToken').value = cfg.adminToken || 'admin123';
    $('#admCfgInterval').value = String(cfg.autoSyncSec !== undefined ? cfg.autoSyncSec : 30);
    $('#admCfgAutoPush').checked = cfg.autoPushOnEdit !== false;
  }

  function readBindForm() {
    return {
      appsScriptUrl: $('#admCfgGasUrl').value.trim(),
      sheetUrl: $('#admCfgSheetUrl').value.trim(),
      sheetName: $('#admCfgSheetName').value.trim(),
      adminToken: $('#admCfgToken').value.trim() || 'admin123',
      autoSyncSec: Number($('#admCfgInterval').value || 0),
      autoPushOnEdit: $('#admCfgAutoPush').checked
    };
  }

  function renderBindOverview(model) {
    var meta = model.syncMeta || {};
    var cfg = model.bindConfig || {};
    var hasGas = Boolean(cfg.appsScriptUrl);
    var parsedSheet = window.CHStore.parseSheetInput(cfg.sheetUrl);
    var hasSheet = Boolean(parsedSheet.spreadsheetId);

    var statusHtml = '';
    if (hasGas) {
      statusHtml = '<span class="tag" style="border-color:rgba(40,199,111,.5);color:var(--ok)">🟢 已绑定 Apps Script 双向同步</span>';
    } else if (hasSheet) {
      statusHtml = '<span class="tag" style="border-color:rgba(62,166,255,.5);color:var(--brand-2)">🔵 已绑定 Google 表格直连读取</span>';
    } else {
      statusHtml = '<span class="tag">⚪ 未绑定在线表格（当前使用本地数据）</span>';
    }
    if (meta.lastSyncAt) {
      statusHtml += ' <span class="tiny muted">最近同步：' + esc(meta.lastSyncAt) + '</span>';
    }
    if (meta.error) {
      statusHtml += ' <span class="tiny" style="color:var(--danger)">错误：' + esc(meta.error) + '</span>';
    }
    $('#admBindStatusBox').innerHTML = statusHtml;

    var cards = [
      { n: model.rows.length,      t: '总行数 (A2:C' + (model.rows.length + 1) + ')' },
      { n: model.people.length,    t: 'A1 姓名 (去重人数)' },
      { n: model.templates.length, t: 'C1 模板数 (固定顺序)' },
      { n: hasGas ? '双向读写' : (hasSheet ? '实时只读' : '本地模式'), t: '当前连接模式' }
    ];
    $('#admDashStats').innerHTML = cards.map(function (c) {
      return '<div class="box"><b>' + esc(c.n) + '</b><span>' + esc(c.t) + '</span></div>';
    }).join('');

    var max = 1;
    model.templates.forEach(function (t) { if ((t.count || 0) > max) max = t.count; });
    $('#admDashPlat').innerHTML = model.templates.map(function (t, idx) {
      var n = t.count || 0;
      return '<tr>' +
        '<td style="width:70px" class="mono muted">顺序 #' + (idx + 1) + '</td>' +
        '<td style="width:130px"><span class="tag"><span style="width:8px;height:8px;border-radius:50%;background:' + esc(t.color) + ';display:inline-block"></span>' + esc(t.name) + '</span></td>' +
        '<td><div style="height:8px;border-radius:6px;background:var(--surface-2);overflow:hidden"><div style="height:100%;width:' + (max ? (n / max * 100) : 0).toFixed(1) + '%;background:' + esc(t.color) + '"></div></div></td>' +
        '<td style="width:90px;text-align:right" class="mono">' + n + ' 行</td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- 一一对应总表（A1 姓名 | B1 关键词 | C1 模板） ---------------- */
  function renderRowsTable(model) {
    var q = ($('#admRQ').value || '').trim().toLowerCase();
    var tpl = $('#admRTpl').value || '';

    var colorMap = {};
    model.templates.forEach(function (t) { colorMap[t.name] = t.color; });

    var list = model.rows.filter(function (r) {
      if (tpl && r.template !== tpl) return false;
      if (q) {
        return r.name.toLowerCase().indexOf(q) >= 0 ||
               r.keyword.toLowerCase().indexOf(q) >= 0 ||
               r.template.toLowerCase().indexOf(q) >= 0;
      }
      return true;
    });

    $('#admRCount').textContent = '当前筛选 ' + list.length + ' 行 / 总计 ' + model.rows.length + ' 行（严格按：番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2 排列）';

    $('#admRBody').innerHTML = list.slice(0, 600).map(function (r) {
      var c = colorMap[r.template] || '#7c5cff';
      var rowIdx = r.id - 1;
      return '<tr>' +
        '<td class="mono muted">第 ' + r.rowNumber + ' 行</td>' +
        '<td><b>' + esc(r.name) + '</b></td>' +
        '<td class="mono">' + esc(r.keyword) + '</td>' +
        '<td><span class="tag"><span style="width:8px;height:8px;border-radius:50%;background:' + esc(c) + ';display:inline-block"></span>' + esc(r.template) + '</span></td>' +
        '<td><div class="ops">' +
          '<button class="btn sm" data-redit="' + rowIdx + '">编辑</button>' +
          '<button class="btn sm danger" data-rdel="' + rowIdx + '">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-mute);padding:28px">暂无记录</td></tr>';

    $$('#admRBody [data-redit]').forEach(function (b) {
      b.onclick = function () { openRowModal(Number(b.dataset.redit)); };
    });
    $$('#admRBody [data-rdel]').forEach(function (b) {
      b.onclick = function () { deleteRow(Number(b.dataset.rdel)); };
    });
  }

  function openRowModal(rowIndex) {
    var model = window.CHStore.getModel();
    var isEdit = typeof rowIndex === 'number' && rowIndex >= 0 && rowIndex < model.rows.length;
    var cur = isEdit ? model.rows[rowIndex] : { name: '', keyword: '', template: $('#admRTpl').value || '番号' };

    var tplOptions = model.templates.map(function (t) {
      return '<option value="' + esc(t.name) + '"' + (cur.template === t.name ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');

    openModal(isEdit ? ('编辑表格第 ' + cur.rowNumber + ' 行') : '新增表格行（自动归入对应模板顺序）',
      '<div class="form-row"><label>A1 姓名 *</label><input class="input" id="admFName" value="' + esc(cur.name) + '" placeholder="输入成员姓名"></div>' +
      '<div class="form-row"><label>B1 关键词 *</label><input class="input" id="admFKeyword" value="' + esc(cur.keyword) + '" placeholder="输入对应的关键词 / 暗号"></div>' +
      '<div class="form-row"><label>C1 模板 *</label><select class="select" id="admFTpl">' + tplOptions + '</select></div>' +
      '<div class="tiny muted">保存后将自动按「番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2」固定顺序排列。</div>' +
      '<div class="err-text" id="admFErr" style="margin-top:6px"></div>',
      function () {
        var name = $('#admFName').value.trim();
        var keyword = $('#admFKeyword').value.trim();
        var tpl = $('#admFTpl').value.trim() || '番号';
        if (!name) { $('#admFErr').textContent = 'A1 姓名不能为空'; return false; }
        if (!keyword) { $('#admFErr').textContent = 'B1 关键词不能为空'; return false; }

        var rows = model.rows.slice();
        if (isEdit) {
          rows[rowIndex] = { name: name, keyword: keyword, template: tpl };
        } else {
          rows.push({ name: name, keyword: keyword, template: tpl });
        }
        closeModal();
        window.CHStore.setRows(rows).then(function () {
          toast('已保存并按固定模板顺序对齐', 'ok');
        });
        return false;
      }
    );
  }

  function deleteRow(rowIndex) {
    var model = window.CHStore.getModel();
    var target = model.rows[rowIndex];
    if (!target) return;
    confirmModal('删除第 ' + target.rowNumber + ' 行',
      '确定删除 <b>' + esc(target.name) + '</b> 的关键词「<b>' + esc(target.keyword) + '</b>」（模板：' + esc(target.template) + '）吗？',
      function () {
        var rows = model.rows.slice();
        rows.splice(rowIndex, 1);
        window.CHStore.setRows(rows).then(function () {
          toast('已删除该行', 'ok');
        });
      }
    );
  }

  /* ---------------- 成员汇总面板 ---------------- */
  function renderPeopleTable(model) {
    var q = ($('#admPQ').value || '').trim().toLowerCase();
    var list = model.people.filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) >= 0;
    });

    $('#admPCount').textContent = '共 ' + list.length + ' 人';
    $('#admPBody').innerHTML = list.map(function (p) {
      var tags = p.entries.map(function (e) {
        return '<span class="tag"><b style="color:var(--text)">' + esc(e.template) + '</b>: ' + esc(e.keyword) + '</span>';
      }).join(' ');
      return '<tr>' +
        '<td style="width:120px"><b>' + esc(p.name) + '</b></td>' +
        '<td style="width:80px" class="mono">' + p.entries.length + ' 条</td>' +
        '<td><div style="display:flex;flex-wrap:wrap;gap:6px">' + tags + '</div></td>' +
        '<td style="width:150px"><div class="ops">' +
          '<button class="btn sm" data-pedit="' + esc(p.name) + '">改名</button>' +
          '<button class="btn sm danger" data-pdel="' + esc(p.name) + '">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-mute);padding:28px">暂无成员</td></tr>';

    $$('#admPBody [data-pedit]').forEach(function (b) {
      b.onclick = function () {
        var oldName = b.dataset.pedit;
        openModal('修改成员姓名',
          '<div class="form-row"><label>原姓名：' + esc(oldName) + '</label>' +
          '<input class="input" id="admPNewName" value="' + esc(oldName) + '" placeholder="输入新姓名"></div>' +
          '<div class="err-text" id="admFErr"></div>',
          function () {
            var newName = $('#admPNewName').value.trim();
            if (!newName) { $('#admFErr').textContent = '姓名不能为空'; return false; }
            var rows = window.CHStore.getModel().rows.map(function (r) {
              return r.name === oldName ? { name: newName, keyword: r.keyword, template: r.template } : r;
            });
            closeModal();
            window.CHStore.setRows(rows).then(function () {
              toast('已更新成员姓名', 'ok');
            });
            return false;
          }
        );
      };
    });

    $$('#admPBody [data-pdel]').forEach(function (b) {
      b.onclick = function () {
        var delName = b.dataset.pdel;
        confirmModal('删除成员全部记录',
          '确定删除「<b>' + esc(delName) + '</b>」名下的全部关键词行吗？',
          function () {
            var rows = window.CHStore.getModel().rows.filter(function (r) {
              return r.name !== delName;
            });
            window.CHStore.setRows(rows).then(function () {
              toast('已删除该成员全部记录', 'ok');
            });
          }
        );
      };
    });
  }

  /* ---------------- 批量粘贴导入 ---------------- */
  function handleBulkImport() {
    var rawText = $('#admBText').value || '';
    var defTpl = $('#admBTpl').value || '番号';
    var mode = $('#admBMode').value || 'append'; // 'append' | 'replace'

    var lines = rawText.split(/\r?\n/);
    var parsed = [];
    var skipped = [];

    lines.forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;
      // 支持 Tab 分隔（直接从 Excel/Google 表格复制的三列）或逗号/空格分隔
      var parts = line.indexOf('\t') >= 0
        ? line.split('\t').map(function (s) { return s.trim(); })
        : line.split(/[,，\s]+/).filter(Boolean);

      if (parts.length < 2) {
        skipped.push('第 ' + (idx + 1) + ' 行缺少关键词：' + line);
        return;
      }
      var name = parts[0];
      var keyword = parts[1];
      var tpl = parts[2] ? window.CHStore.normalizeTemplateName(parts[2]) : defTpl;

      if (name === '姓名' && (keyword === '关键词' || keyword === '暗号')) return;
      parsed.push({ name: name, keyword: keyword, template: tpl });
    });

    if (!parsed.length) {
      toast('未识别到有效行，请检查格式（姓名 关键词 [模板]）', 'err');
      return;
    }

    var baseRows = mode === 'replace' ? [] : window.CHStore.getModel().rows.slice();
    var combined = baseRows.concat(parsed);

    window.CHStore.setRows(combined).then(function (newModel) {
      var msg = '<div class="tag" style="background:rgba(40,199,111,.16);border-color:rgba(40,199,111,.5);color:var(--ok)">' +
        '成功导入 ' + parsed.length + ' 行！当前总表共 ' + newModel.rows.length + ' 行（已按 7 大模板顺序排好）</div>';
      if (skipped.length) {
        msg += '<div class="tiny muted" style="margin-top:8px">跳过 ' + skipped.length + ' 行：<br>' +
          skipped.slice(0, 15).map(esc).join('<br>') + '</div>';
      }
      $('#admBResult').innerHTML = msg;
      toast('批量导入成功（' + parsed.length + ' 行）', 'ok');
    });
  }

  /* ---------------- 站点设置与导出 ---------------- */
  function loadSettingsForm() {
    var model = window.CHStore.getModel();
    var s = model.settings || {};
    $('#admSName').value = s.siteName || '';
    $('#admSSub').value = s.subtitle || '';
    $('#admSLogos').value = (s.logos || []).join(', ');
    var fb = s.feedback || {};
    $('#admFbTitle').value = fb.title || '';
    $('#admFbDesc').value = fb.desc || '';
    $('#admFbEnable').checked = fb.enableForm !== false;
    renderContactsEditor(s.contacts || []);
  }

  function renderContactsEditor(list) {
    $('#admCtList').innerHTML = list.map(function (c) {
      return '<div class="ct-row" style="display:grid;grid-template-columns:110px 1fr 150px auto;gap:8px">' +
        '<input class="input" data-k="type" value="' + esc(c.type || '') + '" placeholder="微信 / TG">' +
        '<input class="input" data-k="value" value="' + esc(c.value || '') + '" placeholder="账号 / 链接">' +
        '<input class="input" data-k="label" value="' + esc(c.label || '') + '" placeholder="备注">' +
        '<button class="btn sm danger" type="button" data-ctdel>删除</button></div>';
    }).join('') || '<div class="tiny muted">暂无联系方式</div>';

    $$('#admCtList [data-ctdel]').forEach(function (b) {
      b.onclick = function () { b.closest('.ct-row').remove(); };
    });
  }

  function readContactsEditor() {
    return $$('#admCtList .ct-row').map(function (r) {
      return {
        type: r.querySelector('[data-k="type"]').value.trim(),
        value: r.querySelector('[data-k="value"]').value.trim(),
        label: r.querySelector('[data-k="label"]').value.trim()
      };
    }).filter(function (c) { return c.value; });
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function exportCsv() {
    var model = window.CHStore.getModel();
    var csvEscape = function (v) {
      var s = String(v == null ? '' : v);
      if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    var lines = ['姓名,关键词,模板'];
    model.rows.forEach(function (r) {
      lines.push([csvEscape(r.name), csvEscape(r.keyword), csvEscape(r.template)].join(','));
    });
    // 添加 UTF-8 BOM，确保 Excel 打开中文不乱码
    downloadFile('暗号表_A姓名_B关键词_C模板.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast('已导出 CSV 表格（严格按番号→聊天→对比→任务→新模版→备用→备用 2 排序）', 'ok');
  }

  function exportDataJs() {
    var model = window.CHStore.getModel();
    var cfg = window.CHStore.getBindConfig();
    var code =
      '/**\n' +
      ' * CipherHub Beta · 默认配置与初始一维表格数据 (由后台导出生成)\n' +
      ' */\n' +
      '(function () {\n' +
      '  \'use strict\';\n\n' +
      '  window.CH_BETA_CONFIG = ' + JSON.stringify({
        appsScriptUrl: cfg.appsScriptUrl || '',
        sheetUrl: cfg.sheetUrl || '',
        sheetName: cfg.sheetName || '',
        adminPass: cfg.adminToken || 'admin123',
        autoSyncSec: cfg.autoSyncSec || 30
      }, null, 2) + ';\n\n' +
      '  window.TEMPLATE_ORDER = ' + JSON.stringify(window.TEMPLATE_ORDER) + ';\n\n' +
      '  window.TEMPLATES = ' + JSON.stringify(window.TEMPLATES, null, 2) + ';\n\n' +
      '  window.TEMPLATE_ALIAS = ' + JSON.stringify(window.TEMPLATE_ALIAS, null, 2) + ';\n\n' +
      '  window.DEFAULT_DATA = ' + JSON.stringify({
        updatedAt: new Date().toISOString(),
        settings: model.settings,
        rows: model.rows.map(function (r) {
          return { name: r.name, keyword: r.keyword, template: r.template };
        })
      }, null, 2) + ';\n' +
      '})();\n';
    downloadFile('data.js', code, 'application/javascript;charset=utf-8');
    toast('已导出 js/data.js，覆盖仓库 js/data.js 后所有人打开即为该配置与数据', 'ok');
  }

  /* ---------------- 弹窗控制 ---------------- */
  var okHandler = null;
  function openModal(title, body, onOk) {
    $('#admMTitle').textContent = title;
    $('#admMBody').innerHTML = body;
    okHandler = onOk;
    $('#admMask').classList.add('on');
    setTimeout(function () {
      var f = $('#admMBody').querySelector('input,select,textarea');
      if (f) f.focus();
    }, 50);
  }
  function closeModal() {
    $('#admMask').classList.remove('on');
    okHandler = null;
  }
  function confirmModal(title, htmlText, onOk) {
    openModal(title, '<div style="font-size:14px;line-height:1.7">' + htmlText + '</div>', function () {
      closeModal();
      onOk();
      return false;
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('#admGateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var inputPass = $('#admGatePass').value.trim();
      if (inputPass !== getPass()) {
        $('#admGateErr').textContent = '后台口令不对（默认：admin123）';
        return;
      }
      $('#admGateErr').textContent = '';
      localStorage.setItem(OK_KEY, '1');
      boot($('#admGate').dataset.targetTab || 'bind');
    });

    $('#admGateCancel').onclick = function (e) {
      e.preventDefault();
      exitAdmin();
    };
    $('#admExit').onclick = exitAdmin;
    $('#admHome').onclick = function (e) {
      e.preventDefault();
      exitAdmin();
    };

    $$('#admTabs button').forEach(function (btn) {
      btn.onclick = function () {
        switchTab(btn.dataset.tab);
      };
    });

    // 在线表格绑定保存与拉取
    $('#admBindSavePull').onclick = function () {
      var cfg = readBindForm();
      window.CHStore.saveBindConfig(cfg);
      if (!cfg.appsScriptUrl && !cfg.sheetUrl) {
        toast('已保存配置（当前未填写在线表格链接，使用本地数据）', 'ok');
        renderAll();
        return;
      }
      var btn = $('#admBindSavePull');
      btn.disabled = true;
      btn.textContent = '正在从在线表格同步…';
      window.CHStore.pullFromOnlineSheet()
        .then(function (m) {
          toast('同步成功！共拉取 ' + m.rows.length + ' 行数据（已与前台统一）', 'ok');
        })
        .catch(function (err) {
          toast('拉取失败：' + err.message, 'err');
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = '🔗 保存绑定并立即从在线表格拉取';
        });
    };

    // 将当前网页数据推送到在线表格
    $('#admBindPushCloud').onclick = function () {
      var cfg = readBindForm();
      window.CHStore.saveBindConfig(cfg);
      var btn = $('#admBindPushCloud');
      btn.disabled = true;
      btn.textContent = '正在写入在线表格…';
      window.CHStore.pushToOnlineSheet('SAVE_ROWS')
        .then(function (m) {
          toast('已将 ' + m.rows.length + ' 行数据按 7 大模板顺序写入在线表格 A/B/C 列！', 'ok');
        })
        .catch(function (err) {
          toast('写入失败：' + err.message, 'err');
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = '☁️ 将当前网页数据推送到在线表格';
        });
    };

    // 从 7 个分表合并到总表
    $('#admBindMergeTabs').onclick = function () {
      var cfg = readBindForm();
      window.CHStore.saveBindConfig(cfg);
      var btn = $('#admBindMergeTabs');
      btn.disabled = true;
      window.CHStore.pushToOnlineSheet('MERGE_TABS')
        .then(function (m) {
          toast('已按「番号→聊天→对比→任务→新模版→备用→备用 2」顺序合并子表，共 ' + m.rows.length + ' 行！', 'ok');
        })
        .catch(function (err) {
          toast('合并失败：' + err.message, 'err');
        })
        .then(function () {
          btn.disabled = false;
        });
    };

    // 在线表格一键重排
    $('#admBindSortCloud').onclick = function () {
      var cfg = readBindForm();
      window.CHStore.saveBindConfig(cfg);
      window.CHStore.pushToOnlineSheet('SORT_SHEET')
        .then(function (m) {
          toast('已将在线表格按 7 大模板顺序重新整理对齐（共 ' + m.rows.length + ' 行）', 'ok');
        })
        .catch(function (err) {
          toast('整理失败：' + err.message, 'err');
        });
    };

    // 一一对应总表操作
    $('#admRQ').addEventListener('input', function () {
      renderRowsTable(window.CHStore.getModel());
    });
    $('#admRTpl').onchange = function () {
      renderRowsTable(window.CHStore.getModel());
    };
    $('#admRAdd').onclick = function () {
      openRowModal(-1);
    };
    $('#admRSort').onclick = function () {
      var rows = window.CHStore.getModel().rows;
      window.CHStore.setRows(rows).then(function () {
        toast('已按「番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2」重新对齐行号', 'ok');
      });
    };

    // 成员搜索
    $('#admPQ').addEventListener('input', function () {
      renderPeopleTable(window.CHStore.getModel());
    });

    // 批量导入
    $('#admBSubmit').onclick = handleBulkImport;

    // 站点设置保存
    $('#admSSave').onclick = function () {
      var logos = $('#admSLogos').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var partial = {
        siteName: $('#admSName').value.trim() || '暗号查询中心 Beta',
        subtitle: $('#admSSub').value.trim()
      };
      if (logos.length) partial.logos = logos;
      window.CHStore.updateSettings(partial, true).then(function () {
        toast('站点信息已保存', 'ok');
      });
    };

    $('#admCtAdd').onclick = function () {
      var list = readContactsEditor();
      list.push({ type: '微信', value: '', label: '' });
      renderContactsEditor(list);
    };

    $('#admFbSave').onclick = function () {
      window.CHStore.updateSettings({
        feedback: {
          title: $('#admFbTitle').value.trim() || '问题反馈',
          desc: $('#admFbDesc').value.trim(),
          enableForm: $('#admFbEnable').checked
        },
        contacts: readContactsEditor()
      }, true).then(function () {
        toast('反馈配置已保存', 'ok');
      });
    };

    // 导出按钮
    $('#admExpCsv').onclick = exportCsv;
    $('#admExpDataJs').onclick = exportDataJs;
    $('#admResetDefault').onclick = function () {
      confirmModal('恢复默认示例数据', '将清除本机缓存的本地改动并恢复初始示例数据（若已绑定在线表格，刷新后仍会拉取在线表格）。确定？', function () {
        window.CHStore.resetToDefault();
        toast('已恢复默认数据', 'ok');
      });
    };

    // 弹窗通用关闭
    $('#admMClose').onclick = closeModal;
    $('#admMCancel').onclick = closeModal;
    $('#admMask').addEventListener('mousedown', function (e) {
      if (e.target === $('#admMask')) closeModal();
    });
    $('#admMOk').onclick = function () {
      if (okHandler) okHandler();
    };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('#admMask').classList.contains('on')) closeModal();
      if (e.key === 'Enter' && $('#admMask').classList.contains('on') && e.target.tagName === 'INPUT') {
        e.preventDefault();
        if (okHandler) okHandler();
      }
    });
  }

  ensureMounted();
})();

