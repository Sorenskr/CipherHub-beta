/**
 * CipherHub Beta · 在线表格实时同步与 1:1 数据中心 (sheet-sync.js)
 *
 * 核心职责：
 *   1. 维护与在线表格完全一一对应的三列数据：A1 姓名 (name) | B1 关键词 (keyword) | C1 模板 (template)
 *   2. 严格执行固定排序规则：
 *      【先放完「番号」表所有人，再放「聊天」表的，接着是对比、任务、新模版、备用、备用 2，不会乱】
 *   3. 支持两种在线表格实时联动方式：
 *      - 方式 A（推荐，双向读写）：绑定 Google Apps Script Web App URL (Code.gs)，支持实时拉取 + 后台网页直接改表写回云端
 *      - 方式 B（免脚本直连只读）：直接粘贴 Google Sheets 分享链接或表格 ID，通过 GViz JSONP / CSV 免跨域实时拉取最新表格内容
 *   4. 支持切回页面自动同步 (visibilitychange) 与定时轮询同步，确保在线表格修改后前台实时统一。
 */
(function () {
  'use strict';

  var BIND_STORAGE_KEY = 'ch_beta_bind_cfg_v1';
  var LOCAL_DATA_KEY   = 'ch_beta_local_data_v1';

  var TEMPLATE_ORDER = window.TEMPLATE_ORDER || ['番号', '聊天', '对比', '任务', '新模版', '备用', '备用 2'];
  var BASE_TEMPLATES = window.TEMPLATES || [];
  var ALIAS = window.TEMPLATE_ALIAS || {};

  function normalizeTemplateName(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '番号';
    if (ALIAS[s]) return ALIAS[s];
    var lower = s.toLowerCase();
    if (ALIAS[lower]) return ALIAS[lower];
    return s;
  }

  function getTemplateOrderIndex(tplName) {
    var norm = normalizeTemplateName(tplName);
    var idx = TEMPLATE_ORDER.indexOf(norm);
    return idx >= 0 ? idx : 999;
  }

  /**
   * 严格按照「番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2」顺序排列
   * 同一个模板内部保持原有的上下行顺序（稳定排序），并生成对应的表格行号 rowNumber (从第 2 行开始，因第 1 行是 A1/B1/C1 表头)
   */
  function sortRowsByTemplateOrder(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map(function (r, i) {
        var name = String(r && r.name !== undefined ? r.name : (r && r[0] !== undefined ? r[0] : '')).trim();
        var keyword = String(r && r.keyword !== undefined ? r.keyword : (r && r.value !== undefined ? r.value : (r && r[1] !== undefined ? r[1] : ''))).trim();
        var rawTpl = r && r.template !== undefined ? r.template : (r && r.platformName !== undefined ? r.platformName : (r && r[2] !== undefined ? r[2] : '番号'));
        var tpl = normalizeTemplateName(rawTpl);
        return {
          _origIdx: i,
          name: name,
          keyword: keyword,
          template: tpl,
          _orderIdx: getTemplateOrderIndex(tpl)
        };
      })
      .filter(function (item) {
        if (!item.name && !item.keyword) return false;
        // 自动过滤误传入的表头行
        if (item.name === '姓名' && (item.keyword === '关键词' || item.keyword === '暗号') && (item.template === '模板' || item.template === '模版' || item.template === '番号')) {
          return false;
        }
        return true;
      })
      .sort(function (a, b) {
        if (a._orderIdx !== b._orderIdx) return a._orderIdx - b._orderIdx;
        if (a._orderIdx === 999 && a.template !== b.template) {
          return a.template.localeCompare(b.template, 'zh-CN');
        }
        return a._origIdx - b._origIdx;
      })
      .map(function (item, idx) {
        return {
          id: idx + 1,
          rowNumber: idx + 2, // A1/B1/C1 为第 1 行，数据从第 2 行开始一一对应
          name: item.name,
          keyword: item.keyword,
          template: item.template
        };
      });
  }

  /**
   * 从 Google 表格链接或 ID 字符串中提取 Spreadsheet ID 与 gid
   */
  function parseSheetInput(input) {
    var s = String(input || '').trim();
    if (!s) return { spreadsheetId: '', gid: '' };
    var mId = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    var mGid = s.match(/[?#&]gid=(\d+)/);
    if (mId) {
      return { spreadsheetId: mId[1], gid: mGid ? mGid[1] : '' };
    }
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) {
      return { spreadsheetId: s, gid: '' };
    }
    return { spreadsheetId: '', gid: '' };
  }

  function loadBindConfig() {
    var def = window.CH_BETA_CONFIG || {};
    var saved = {};
    try {
      var raw = localStorage.getItem(BIND_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) || {};
    } catch (e) {}

    return {
      appsScriptUrl: String(saved.appsScriptUrl || def.appsScriptUrl || '').trim(),
      sheetUrl:      String(saved.sheetUrl || def.sheetUrl || '').trim(),
      sheetName:     String(saved.sheetName || def.sheetName || '').trim(),
      adminToken:    String(saved.adminToken || def.adminPass || 'admin123').trim(),
      autoSyncSec:   saved.autoSyncSec !== undefined ? Number(saved.autoSyncSec) : Number(def.autoSyncSec || 30),
      autoPushOnEdit: saved.autoPushOnEdit !== undefined ? Boolean(saved.autoPushOnEdit) : true
    };
  }

  function saveBindConfig(cfg) {
    var merged = Object.assign(loadBindConfig(), cfg || {});
    try {
      localStorage.setItem(BIND_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {}
    setupAutoSyncTimer();
    return merged;
  }

  function loadLocalData() {
    var def = window.DEFAULT_DATA || { settings: {}, rows: [] };
    try {
      var raw = localStorage.getItem(LOCAL_DATA_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) {
          return {
            updatedAt: parsed.updatedAt || def.updatedAt,
            settings: Object.assign({}, def.settings, parsed.settings || {}),
            rows: sortRowsByTemplateOrder(parsed.rows),
            source: parsed.source || 'local'
          };
        }
      }
    } catch (e) {}
    return {
      updatedAt: def.updatedAt || new Date().toISOString(),
      settings: JSON.parse(JSON.stringify(def.settings || {})),
      rows: sortRowsByTemplateOrder(def.rows || []),
      source: 'default'
    };
  }

  var state = loadLocalData();
  var syncMeta = {
    status: 'idle', // 'idle' | 'syncing' | 'ok' | 'err'
    lastSyncAt: '',
    error: '',
    mode: '', // 'gas' | 'gviz' | 'local'
    sheetTitle: ''
  };
  var listeners = [];
  var autoSyncTimer = null;

  function persistState() {
    try {
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify({
        updatedAt: state.updatedAt,
        settings: state.settings,
        rows: state.rows,
        source: state.source
      }));
    } catch (e) {}
  }

  function notify() {
    var snapshot = buildDerivedModel();
    listeners.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (e) {}
    });
  }

  /**
   * 将一维 rows (A1姓名 / B1关键词 / C1模板) 转换为前台与后台所需的完整结构
   */
  function buildDerivedModel() {
    var rows = sortRowsByTemplateOrder(state.rows);
    var tplMap = {};
    var templates = BASE_TEMPLATES.map(function (t) {
      var copy = Object.assign({}, t, { count: 0 });
      tplMap[t.name] = copy;
      return copy;
    });

    // 若表格 C 列出现了 7 个标准模板之外的自定义模板名，自动追加在 7 个标准模板之后
    rows.forEach(function (r) {
      if (!tplMap[r.template]) {
        var customTpl = {
          id: 'tpl_' + templates.length,
          name: r.template,
          short: r.template.slice(0, 1),
          color: '#6e56cf',
          order: templates.length + 1,
          count: 0
        };
        tplMap[r.template] = customTpl;
        templates.push(customTpl);
      }
      tplMap[r.template].count++;
    });

    // 按姓名聚合生成成员列表（保持成员在表内首次出现的顺序）
    var peopleMap = {};
    var people = [];
    var entries = [];
    var defaultGroup = (state.settings && state.settings.groups && state.settings.groups[0]) || 'Laya';

    rows.forEach(function (r, idx) {
      var personName = r.name || '未命名';
      var person = peopleMap[personName];
      if (!person) {
        person = {
          id: people.length + 1,
          name: personName,
          group: defaultGroup,
          entries: []
        };
        peopleMap[personName] = person;
        people.push(person);
      }
      var tplInfo = tplMap[r.template] || templates[0];
      var entry = {
        id: idx + 1,
        rowNumber: r.rowNumber,
        personId: person.id,
        personName: person.name,
        name: person.name,
        keyword: r.keyword,
        value: r.keyword,
        template: r.template,
        platformId: tplInfo.id,
        platformName: tplInfo.name,
        color: tplInfo.color,
        order: tplInfo.order
      };
      person.entries.push(entry);
      entries.push(entry);
    });

    var byTemplate = {};
    templates.forEach(function (t) { byTemplate[t.id] = t.count; byTemplate[t.name] = t.count; });

    return {
      updatedAt: state.updatedAt,
      source: state.source,
      syncMeta: Object.assign({}, syncMeta),
      bindConfig: loadBindConfig(),
      settings: state.settings,
      templateOrder: TEMPLATE_ORDER.slice(),
      templates: templates,
      rows: rows,
      people: people,
      entries: entries,
      stats: {
        people: people.length,
        entries: entries.length,
        rows: rows.length,
        templates: templates.length,
        byTemplate: byTemplate,
        updatedAt: state.updatedAt
      }
    };
  }

  /**
   * 方式 B：通过 Google Visualization JSONP 免跨域直接读取公开 Google 表格
   */
  function fetchGoogleSheetViaGviz(spreadsheetId, gid, sheetName) {
    return new Promise(function (resolve, reject) {
      var cbName = '__ch_gviz_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      var script = document.createElement('script');
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error('直接读取 Google 表格超时，请确认表格已开启「知道链接的任何人可查看」或配置 Apps Script 链接'));
      }, 12000);

      function cleanup() {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      }

      window[cbName] = function (resp) {
        cleanup();
        if (!resp || resp.status === 'error') {
          var errMsg = (resp && resp.errors && resp.errors[0] && resp.errors[0].detailed_message) || '读取在线表格失败';
          reject(new Error(errMsg));
          return;
        }
        var table = resp.table || {};
        var cols = table.cols || [];
        var rawRows = table.rows || [];
        var parsed = [];

        // 检查列标题是否被识别到了 cols.label 中
        var colLabels = cols.map(function (c) { return String((c && c.label) || '').trim(); });
        for (var i = 0; i < rawRows.length; i++) {
          var c = (rawRows[i] && rawRows[i].c) || [];
          var v0 = c[0] && (c[0].f !== undefined && c[0].f !== null ? c[0].f : c[0].v);
          var v1 = c[1] && (c[1].f !== undefined && c[1].f !== null ? c[1].f : c[1].v);
          var v2 = c[2] && (c[2].f !== undefined && c[2].f !== null ? c[2].f : c[2].v);
          var name = String(v0 == null ? '' : v0).trim();
          var keyword = String(v1 == null ? '' : v1).trim();
          var tpl = normalizeTemplateName(v2 == null ? (sheetName || '番号') : v2);
          if (!name && !keyword) continue;
          if (name === '姓名' && (keyword === '关键词' || keyword === '暗号')) continue;
          parsed.push({ name: name, keyword: keyword, template: tpl });
        }
        resolve({
          ok: true,
          rows: sortRowsByTemplateOrder(parsed),
          colLabels: colLabels
        });
      };

      var url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(spreadsheetId) +
        '/gviz/tq?tqx=responseHandler:' + cbName;
      if (sheetName) {
        url += '&sheet=' + encodeURIComponent(sheetName);
      } else if (gid) {
        url += '&gid=' + encodeURIComponent(gid);
      }
      url += '&_t=' + Date.now();

      script.src = url;
      script.onerror = function () {
        cleanup();
        reject(new Error('无法连接 Google 表格，请检查网络或表格权限（需设为「知道链接的任何人可查看」）'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * 从绑定的在线表格实时拉取最新数据并同步到前台
   */
  function pullFromOnlineSheet(opts) {
    opts = opts || {};
    var cfg = loadBindConfig();
    var gasUrl = cfg.appsScriptUrl;
    var parsedSheet = parseSheetInput(cfg.sheetUrl);

    if (!gasUrl && !parsedSheet.spreadsheetId) {
      syncMeta.status = 'idle';
      syncMeta.mode = 'local';
      notify();
      return Promise.resolve(buildDerivedModel());
    }

    syncMeta.status = 'syncing';
    syncMeta.error = '';
    notify();

    // 优先使用 Apps Script Web App 接口（支持读取完整结构 + 站点设置 + 自动合并子表）
    if (gasUrl) {
      var sep = gasUrl.indexOf('?') >= 0 ? '&' : '?';
      var reqUrl = gasUrl + sep + 'action=bootstrap&_t=' + Date.now();
      if (parsedSheet.spreadsheetId) reqUrl += '&spreadsheetId=' + encodeURIComponent(parsedSheet.spreadsheetId);
      if (cfg.sheetName) reqUrl += '&sheet=' + encodeURIComponent(cfg.sheetName);

      return fetch(reqUrl, { method: 'GET', cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!data || data.ok === false) {
            throw new Error((data && data.error) || 'Apps Script 返回异常');
          }
          if (Array.isArray(data.rows)) {
            state.rows = sortRowsByTemplateOrder(data.rows);
          }
          if (data.settings && typeof data.settings === 'object') {
            state.settings = Object.assign({}, state.settings, data.settings);
          }
          state.updatedAt = data.updatedAt || new Date().toISOString();
          state.source = 'cloud-gas';
          syncMeta.status = 'ok';
          syncMeta.mode = 'gas';
          syncMeta.lastSyncAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          syncMeta.sheetTitle = (data.spreadsheetName ? data.spreadsheetName + ' · ' : '') + (data.sheetName || '总表');
          syncMeta.error = '';
          persistState();
          notify();
          return buildDerivedModel();
        })
        .catch(function (err) {
          // 若同时填了 Google 表格链接，自动降级尝试 GViz 直连读取
          if (parsedSheet.spreadsheetId) {
            return fetchGoogleSheetViaGviz(parsedSheet.spreadsheetId, parsedSheet.gid, cfg.sheetName)
              .then(function (gvizRes) {
                state.rows = gvizRes.rows;
                state.updatedAt = new Date().toISOString();
                state.source = 'cloud-gviz';
                syncMeta.status = 'ok';
                syncMeta.mode = 'gviz';
                syncMeta.lastSyncAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                syncMeta.sheetTitle = cfg.sheetName || 'Google 在线表格';
                syncMeta.error = '';
                persistState();
                notify();
                return buildDerivedModel();
              })
              .catch(function () {
                syncMeta.status = 'err';
                syncMeta.error = err.message || '同步失败';
                notify();
                throw err;
              });
          }
          syncMeta.status = 'err';
          syncMeta.error = err.message || '同步失败';
          notify();
          throw err;
        });
    }

    // 仅配置了 Google 表格链接/ID 时，使用 GViz JSONP 直连拉取
    return fetchGoogleSheetViaGviz(parsedSheet.spreadsheetId, parsedSheet.gid, cfg.sheetName)
      .then(function (res) {
        state.rows = res.rows;
        state.updatedAt = new Date().toISOString();
        state.source = 'cloud-gviz';
        syncMeta.status = 'ok';
        syncMeta.mode = 'gviz';
        syncMeta.lastSyncAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        syncMeta.sheetTitle = cfg.sheetName || 'Google 在线表格';
        syncMeta.error = '';
        persistState();
        notify();
        return buildDerivedModel();
      })
      .catch(function (err) {
        syncMeta.status = 'err';
        syncMeta.error = err.message || '读取表格失败';
        notify();
        throw err;
      });
  }

  /**
   * 将当前数据推送到在线表格（通过 Google Apps Script doPost）
   * 写入前强制按「番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2」顺序排列
   */
  function pushToOnlineSheet(customAction, extraPayload) {
    var cfg = loadBindConfig();
    if (!cfg.appsScriptUrl) {
      return Promise.reject(new Error('请先在后台「在线表格绑定」中填写 Google Apps Script 部署链接 (Web App URL)'));
    }
    var parsedSheet = parseSheetInput(cfg.sheetUrl);
    var sortedRows = sortRowsByTemplateOrder(state.rows);
    var payload = Object.assign({
      action: customAction || 'SAVE_ROWS',
      token: cfg.adminToken || 'admin123',
      spreadsheetId: parsedSheet.spreadsheetId || '',
      sheetName: cfg.sheetName || '',
      rows: sortedRows.map(function (r) {
        return { name: r.name, keyword: r.keyword, template: r.template };
      }),
      settings: state.settings
    }, extraPayload || {});

    syncMeta.status = 'syncing';
    notify();

    return fetch(cfg.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (res) {
        if (!res || res.ok === false) {
          throw new Error((res && res.error) || '写入在线表格失败');
        }
        if (Array.isArray(res.rows)) {
          state.rows = sortRowsByTemplateOrder(res.rows);
        } else {
          state.rows = sortedRows;
        }
        state.updatedAt = res.updatedAt || new Date().toISOString();
        state.source = 'cloud-gas';
        syncMeta.status = 'ok';
        syncMeta.mode = 'gas';
        syncMeta.lastSyncAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        syncMeta.error = '';
        persistState();
        notify();
        return buildDerivedModel();
      })
      .catch(function (err) {
        syncMeta.status = 'err';
        syncMeta.error = err.message || '写入失败';
        notify();
        throw err;
      });
  }

  function setRows(newRows, options) {
    options = options || {};
    state.rows = sortRowsByTemplateOrder(newRows);
    state.updatedAt = new Date().toISOString();
    if (!options.keepSource) state.source = 'local-edited';
    persistState();
    notify();

    var cfg = loadBindConfig();
    if (options.pushCloud || (options.autoPush !== false && cfg.autoPushOnEdit && cfg.appsScriptUrl)) {
      return pushToOnlineSheet('SAVE_ROWS').catch(function () {});
    }
    return Promise.resolve(buildDerivedModel());
  }

  function updateSettings(newSettings, pushCloud) {
    state.settings = Object.assign({}, state.settings, newSettings || {});
    state.updatedAt = new Date().toISOString();
    persistState();
    notify();

    var cfg = loadBindConfig();
    if (pushCloud && cfg.appsScriptUrl) {
      return pushToOnlineSheet('SAVE_SETTINGS', { settings: state.settings });
    }
    return Promise.resolve(buildDerivedModel());
  }

  function resetToDefault() {
    localStorage.removeItem(LOCAL_DATA_KEY);
    var def = window.DEFAULT_DATA || { settings: {}, rows: [] };
    state = {
      updatedAt: new Date().toISOString(),
      settings: JSON.parse(JSON.stringify(def.settings || {})),
      rows: sortRowsByTemplateOrder(def.rows || []),
      source: 'default'
    };
    persistState();
    notify();
    return buildDerivedModel();
  }

  function setupAutoSyncTimer() {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    var cfg = loadBindConfig();
    var hasRemote = Boolean(cfg.appsScriptUrl || parseSheetInput(cfg.sheetUrl).spreadsheetId);
    var sec = Number(cfg.autoSyncSec || 0);
    if (hasRemote && sec >= 10) {
      autoSyncTimer = setInterval(function () {
        if (document.hidden) return;
        if (document.body.classList.contains('adm-on')) return;
        pullFromOnlineSheet({ silent: true }).catch(function () {});
      }, sec * 1000);
    }
  }

  // 当用户从 Google 表格标签页改完切回本网页时，自动触发一次实时拉取
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !document.body.classList.contains('adm-on')) {
      var cfg = loadBindConfig();
      if (cfg.appsScriptUrl || parseSheetInput(cfg.sheetUrl).spreadsheetId) {
        pullFromOnlineSheet({ silent: true }).catch(function () {});
      }
    }
  });

  window.CHStore = {
    TEMPLATE_ORDER: TEMPLATE_ORDER,
    normalizeTemplateName: normalizeTemplateName,
    getTemplateOrderIndex: getTemplateOrderIndex,
    sortRowsByTemplateOrder: sortRowsByTemplateOrder,
    parseSheetInput: parseSheetInput,
    getBindConfig: loadBindConfig,
    saveBindConfig: saveBindConfig,
    getModel: buildDerivedModel,
    setRows: setRows,
    updateSettings: updateSettings,
    resetToDefault: resetToDefault,
    pullFromOnlineSheet: pullFromOnlineSheet,
    pushToOnlineSheet: pushToOnlineSheet,
    subscribe: function (fn) {
      if (typeof fn === 'function' && listeners.indexOf(fn) < 0) {
        listeners.push(fn);
      }
    }
  };

  setupAutoSyncTimer();
})();

