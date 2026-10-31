/**
 * ============================================================================
 * CipherHub Beta（暗号/关键词查询中心 · 在线表格实时同步版）— Google Apps Script (Code.gs)
 * ============================================================================
 *
 * 【绑定的在线表格格式（与前台 1:1 严格对应）】
 *   - A1: 姓名
 *   - B1: 关键词
 *   - C1: 模板
 *
 * 【固定模板排列顺序（从上往下拼接，绝不乱序）】
 *   1. 番号
 *   2. 聊天
 *   3. 对比
 *   4. 任务
 *   5. 新模版
 *   6. 备用
 *   7. 备用 2
 *
 * 【支持能力】
 *   1. doGet 实时拉取：每次前台打开或点击刷新，直接读取在线表格 A:C 列最新数据，
 *      按「番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2」顺序返回给前台。
 *   2. 自动兼容多子表汇总：若表格中存在「番号/聊天/对比/任务/新模版/备用/备用 2」分表，
 *      支持一键按顺序从上往下拼合到主表（A1 姓名 / B1 关键词 / C1 模板）。
 *   3. doPost 双向同步：后台网页增删改、批量导入或排序后，可一键写回在线表格并自动按模板顺序排好。
 *   4. 问题反馈收集：前台提交的反馈自动写入 `CH_Feedback` 工作表。
 */

var SPREADSHEET_ID = ''; // 可留空（脚本直接绑定在表格「扩展程序 -> Apps Script」中时自动获取当前表格）；若独立创建脚本可填入表格 ID
var ADMIN_TOKEN = 'admin123'; // 后台写入密钥（与网页后台口令/密钥一致，可自定义修改）

var MAIN_SHEET_NAME = '总表'; // 默认主表名称（若找不到则自动使用第一个含 A1=姓名 的工作表或首个工作表）
var FEEDBACK_SHEET_NAME = 'CH_Feedback';

var HEADERS = ['姓名', '关键词', '模板'];
var TEMPLATE_ORDER = ['番号', '聊天', '对比', '任务', '新模版', '备用', '备用 2'];

var TEMPLATE_META = [
  { id: 'fanhao',   name: '番号',   color: '#7c5cff', order: 1 },
  { id: 'liaotian', name: '聊天',   color: '#00c8b4', order: 2 },
  { id: 'duibi',    name: '对比',   color: '#ff7a59', order: 3 },
  { id: 'renwu',    name: '任务',   color: '#3ea6ff', order: 4 },
  { id: 'xinmoban', name: '新模版', color: '#e1306c', order: 5 },
  { id: 'beiyong',  name: '备用',   color: '#ffb020', order: 6 },
  { id: 'beiyong2', name: '备用 2', color: '#8b93a7', order: 7 }
];

var TEMPLATE_ALIAS = {
  '番号': '番号',
  'fanhao': '番号',
  '聊天': '聊天',
  'liaotian': '聊天',
  '对比': '对比',
  'duibi': '对比',
  '任务': '任务',
  'renwu': '任务',
  '新模版': '新模版',
  '新模板': '新模版',
  'xinmoban': '新模版',
  '备用': '备用',
  '备用1': '备用',
  '备用 1': '备用',
  'beiyong': '备用',
  '备用2': '备用 2',
  '备用 2': '备用 2',
  'beiyong2': '备用 2'
};

function normalizeTemplateName_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '番号';
  if (TEMPLATE_ALIAS[s]) return TEMPLATE_ALIAS[s];
  var lower = s.toLowerCase();
  if (TEMPLATE_ALIAS[lower]) return TEMPLATE_ALIAS[lower];
  return s;
}

function getTemplateOrderIndex_(tplName) {
  var norm = normalizeTemplateName_(tplName);
  var idx = TEMPLATE_ORDER.indexOf(norm);
  return idx >= 0 ? idx : 999;
}

function getSpreadsheet_(overrideId) {
  var sid = String(overrideId || SPREADSHEET_ID || '').trim();
  if (sid) {
    return SpreadsheetApp.openById(sid);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('未绑定 Google 表格：请在表格内通过「扩展程序 → Apps Script」打开，或在 Code.gs 顶部填写 SPREADSHEET_ID');
}

function ensureMainSheet_(ss, preferredSheetName) {
  var sheets = ss.getSheets();
  var targetName = String(preferredSheetName || '').trim();

  if (targetName) {
    var byName = ss.getSheetByName(targetName);
    if (byName) return byName;
  }

  // 1. 优先寻找表头已经是 A1=姓名, B1=关键词, C1=模板 的工作表
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var nm = sh.getName();
    if (nm === FEEDBACK_SHEET_NAME) continue;
    if (sh.getLastRow() >= 1 && sh.getLastColumn() >= 2) {
      var h = sh.getRange(1, 1, 1, Math.min(3, sh.getLastColumn())).getValues()[0];
      var a1 = String(h[0] || '').trim();
      var b1 = String(h[1] || '').trim();
      if (a1 === '姓名' && (b1 === '关键词' || b1 === '暗号')) {
        return sh;
      }
    }
  }

  // 2. 找名为「总表」的工作表
  var mainSh = ss.getSheetByName(MAIN_SHEET_NAME);
  if (mainSh) return mainSh;

  // 3. 如果第一个工作表不是 7 个子表名之一，直接用第一个工作表
  if (sheets.length > 0 && TEMPLATE_ORDER.indexOf(sheets[0].getName().trim()) < 0 && sheets[0].getName() !== FEEDBACK_SHEET_NAME) {
    var first = sheets[0];
    if (first.getLastRow() === 0) {
      first.getRange(1, 1, 1, 3).setValues([HEADERS]);
    }
    return first;
  }

  // 4. 否则新建「总表」放在最前面
  var created = ss.insertSheet(MAIN_SHEET_NAME, 0);
  created.getRange(1, 1, 1, 3).setValues([HEADERS]);
  return created;
}

/**
 * 按模板顺序对 rows 数组排序：
 * 先放完「番号」所有人，再放「聊天」，接着是「对比、任务、新模版、备用、备用 2」
 * 同一模板内部保持原有从上往下的相对顺序（稳定排序）
 */
function sortRowsByTemplateOrder_(rows) {
  return rows
    .map(function (r, idx) {
      var tpl = normalizeTemplateName_(r.template || r[2] || '番号');
      return {
        idx: idx,
        name: String(r.name !== undefined ? r.name : (r[0] || '')).trim(),
        keyword: String(r.keyword !== undefined ? r.keyword : (r[1] || '')).trim(),
        template: tpl,
        orderIdx: getTemplateOrderIndex_(tpl)
      };
    })
    .filter(function (item) {
      return item.name || item.keyword;
    })
    .sort(function (a, b) {
      if (a.orderIdx !== b.orderIdx) return a.orderIdx - b.orderIdx;
      if (a.orderIdx === 999 && a.template !== b.template) {
        return a.template.localeCompare(b.template, 'zh-CN');
      }
      return a.idx - b.idx;
    })
    .map(function (item, newIdx) {
      return {
        rowNumber: newIdx + 2,
        name: item.name,
        keyword: item.keyword,
        template: item.template
      };
    });
}

/**
 * 从子表（番号、聊天、对比、任务、新模版、备用、备用 2）按顺序抽取并合并数据
 */
function collectRowsFromTemplateTabs_(ss) {
  var collected = [];
  for (var t = 0; t < TEMPLATE_ORDER.length; t++) {
    var tplName = TEMPLATE_ORDER[t];
    var sh = ss.getSheetByName(tplName);
    if (!sh && tplName === '新模版') sh = ss.getSheetByName('新模板');
    if (!sh && tplName === '备用 2') sh = ss.getSheetByName('备用2');
    if (!sh) continue;

    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 2) continue;

    var values = sh.getRange(1, 1, lastRow, Math.min(lastCol, 10)).getValues();
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var c0 = String(row[0] == null ? '' : row[0]).trim();
      var c1 = String(row[1] == null ? '' : row[1]).trim();
      if (!c0 && !c1) continue;
      // 跳过表头行
      if (r === 0 && (c0 === '姓名' || c0 === '名字' || c0 === '成员' || c1 === '关键词' || c1 === '暗号')) {
        continue;
      }
      // 支持一行中 B 列或后续列有关键词（若只有 A姓名 B关键词 则一一对应）
      if (c0 && c1) {
        collected.push({
          name: c0,
          keyword: c1,
          template: tplName
        });
      }
    }
  }
  return sortRowsByTemplateOrder_(collected);
}

/**
 * 读取在线表格数据（A1 姓名 / B1 关键词 / C1 模板）
 */
function readSheetRows_(ss, sheetName, autoFormatSheet) {
  var sh = ensureMainSheet_(ss, sheetName);
  var lastRow = sh.getLastRow();
  var rawRows = [];

  if (lastRow >= 2) {
    var numCols = Math.max(3, Math.min(sh.getLastColumn(), 5));
    var values = sh.getRange(2, 1, lastRow - 1, numCols).getValues();
    for (var i = 0; i < values.length; i++) {
      var name = String(values[i][0] == null ? '' : values[i][0]).trim();
      var keyword = String(values[i][1] == null ? '' : values[i][1]).trim();
      var tpl = normalizeTemplateName_(values[i][2] == null ? '番号' : values[i][2]);
      if (!name && !keyword) continue;
      if (name === '姓名' && (keyword === '关键词' || keyword === '暗号')) continue;
      rawRows.push({
        name: name,
        keyword: keyword,
        template: tpl
      });
    }
  }

  // 若主表为空，尝试自动从 7 个子表（番号/聊天/对比/任务/新模版/备用/备用 2）按顺序拼合
  if (rawRows.length === 0) {
    var fromTabs = collectRowsFromTemplateTabs_(ss);
    if (fromTabs.length > 0) {
      writeRowsToSheet_(sh, fromTabs);
      return {
        sheetName: sh.getName(),
        spreadsheetId: ss.getId(),
        spreadsheetName: ss.getName(),
        rows: fromTabs
      };
    }
  }

  var sorted = sortRowsByTemplateOrder_(rawRows);
  if (autoFormatSheet) {
    writeRowsToSheet_(sh, sorted);
  }

  return {
    sheetName: sh.getName(),
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    rows: sorted
  };
}

/**
 * 将排好序的 rows 写回工作表，严格保持 A1=姓名, B1=关键词, C1=模板
 */
function writeRowsToSheet_(sh, rows) {
  var sorted = sortRowsByTemplateOrder_(rows || []);
  sh.clearContents();
  var matrix = [HEADERS];
  for (var i = 0; i < sorted.length; i++) {
    matrix.push([sorted[i].name, sorted[i].keyword, sorted[i].template]);
  }
  sh.getRange(1, 1, matrix.length, 3).setValues(matrix);
  // 冻结首行表头
  try { sh.setFrozenRows(1); } catch (e) {}
  return sorted;
}

function getSiteSettings_() {
  var raw = PropertiesService.getScriptProperties().getProperty('CH_BETA_SETTINGS');
  var def = {
    siteName: '暗号查询中心 Beta',
    subtitle: '支持按姓名正查名下全部关键词，或输入暗号关键词反查归属人',
    groups: ['Laya'],
    logos: ['assets/Laya.png', 'assets/Laya2.png'],
    feedback: {
      title: '问题反馈',
      desc: '查不到、关键词有误、需要新增 —— 都可以直接告诉我们',
      enableForm: true
    },
    contacts: []
  };
  if (!raw) return def;
  try {
    var parsed = JSON.parse(raw);
    return Object.assign(def, parsed || {});
  } catch (e) {
    return def;
  }
}

function saveSiteSettings_(settings) {
  var cur = getSiteSettings_();
  var merged = Object.assign(cur, settings || {});
  PropertiesService.getScriptProperties().setProperty('CH_BETA_SETTINGS', JSON.stringify(merged));
  return merged;
}

function appendFeedback_(payload) {
  var ss = getSpreadsheet_(payload && payload.spreadsheetId);
  var sh = ss.getSheetByName(FEEDBACK_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(FEEDBACK_SHEET_NAME);
    sh.getRange(1, 1, 1, 5).setValues([['时间', '称呼/姓名', '联系方式', '反馈内容', '状态']]);
    try { sh.setFrozenRows(1); } catch (e) {}
  }
  var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
  sh.appendRow([
    now,
    String((payload && payload.name) || '匿名').trim(),
    String((payload && payload.contact) || '').trim(),
    String((payload && payload.message) || '').trim(),
    'new'
  ]);
  return { ok: true, createdAt: now };
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(reqToken) {
  var savedToken = PropertiesService.getScriptProperties().getProperty('CH_ADMIN_TOKEN') || ADMIN_TOKEN;
  if (!savedToken) return true;
  return String(reqToken || '').trim() === String(savedToken).trim();
}

/**
 * GET 请求入口：
 *   - ?action=bootstrap (默认)：拉取完整在线表格数据 (A1姓名/B1关键词/C1模板) + 站点配置 + 模板顺序
 *   - ?action=ping：健康检查
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = String(params.action || 'bootstrap').toLowerCase();

    if (action === 'ping') {
      return jsonOut_({ ok: true, status: 'online', updatedAt: new Date().toISOString() });
    }

    var ss = getSpreadsheet_(params.spreadsheetId);
    var autoSort = params.autoSort === '1' || params.autoSort === 'true';
    var sheetData = readSheetRows_(ss, params.sheet, autoSort);

    return jsonOut_({
      ok: true,
      updatedAt: new Date().toISOString(),
      spreadsheetId: sheetData.spreadsheetId,
      spreadsheetName: sheetData.spreadsheetName,
      sheetName: sheetData.sheetName,
      headers: HEADERS,
      templateOrder: TEMPLATE_ORDER,
      templates: TEMPLATE_META,
      settings: getSiteSettings_(),
      rows: sheetData.rows
    });
  } catch (err) {
    return jsonOut_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/**
 * POST 请求入口（使用 text/plain JSON 避免浏览器 CORS 预检拦截）：
 *   - action: 'SAVE_ROWS'     全量覆盖保存 A1姓名/B1关键词/C1模板（自动按 7 大模板顺序排好）
 *   - action: 'UPSERT_ROW'    新增或修改单行并自动归入对应模板分组末尾
 *   - action: 'DELETE_ROW'    删除指定行
 *   - action: 'SORT_SHEET'    将当前在线表格按「番号→聊天→对比→任务→新模版→备用→备用 2」重新整理排序
 *   - action: 'MERGE_TABS'    从 7 个分表按顺序合并生成主表
 *   - action: 'SAVE_SETTINGS' 保存站点设置
 *   - action: 'FEEDBACK'      前台用户提交问题反馈（无需管理员密钥）
 */
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var action = String(body.action || '').toUpperCase();

    if (action === 'FEEDBACK') {
      return jsonOut_(appendFeedback_(body));
    }

    if (!checkToken_(body.token)) {
      return jsonOut_({ ok: false, error: '后台管理密钥（ADMIN_TOKEN）不正确' });
    }

    var ss = getSpreadsheet_(body.spreadsheetId);
    var sh = ensureMainSheet_(ss, body.sheetName);

    if (action === 'SAVE_ROWS') {
      var incoming = Array.isArray(body.rows) ? body.rows : [];
      var saved = writeRowsToSheet_(sh, incoming);
      if (body.settings) saveSiteSettings_(body.settings);
      return jsonOut_({
        ok: true,
        updatedAt: new Date().toISOString(),
        sheetName: sh.getName(),
        total: saved.length,
        rows: saved
      });
    }

    if (action === 'SORT_SHEET') {
      var current = readSheetRows_(ss, body.sheetName, true);
      return jsonOut_({
        ok: true,
        updatedAt: new Date().toISOString(),
        sheetName: current.sheetName,
        total: current.rows.length,
        rows: current.rows
      });
    }

    if (action === 'MERGE_TABS') {
      var merged = collectRowsFromTemplateTabs_(ss);
      var written = writeRowsToSheet_(sh, merged);
      return jsonOut_({
        ok: true,
        updatedAt: new Date().toISOString(),
        sheetName: sh.getName(),
        total: written.length,
        rows: written
      });
    }

    if (action === 'UPSERT_ROW') {
      var curData = readSheetRows_(ss, body.sheetName, false).rows;
      var rowObj = body.row || {};
      var targetIdx = typeof body.rowIndex === 'number' ? body.rowIndex : -1;
      var cleanRow = {
        name: String(rowObj.name || '').trim(),
        keyword: String(rowObj.keyword || '').trim(),
        template: normalizeTemplateName_(rowObj.template || '番号')
      };
      if (!cleanRow.name || !cleanRow.keyword) {
        return jsonOut_({ ok: false, error: '姓名和关键词不能为空' });
      }
      if (targetIdx >= 0 && targetIdx < curData.length) {
        curData[targetIdx] = cleanRow;
      } else {
        curData.push(cleanRow);
      }
      var afterUpsert = writeRowsToSheet_(sh, curData);
      return jsonOut_({
        ok: true,
        updatedAt: new Date().toISOString(),
        total: afterUpsert.length,
        rows: afterUpsert
      });
    }

    if (action === 'DELETE_ROW') {
      var list = readSheetRows_(ss, body.sheetName, false).rows;
      var delIdx = typeof body.rowIndex === 'number' ? body.rowIndex : -1;
      if (delIdx >= 0 && delIdx < list.length) {
        list.splice(delIdx, 1);
      }
      var afterDel = writeRowsToSheet_(sh, list);
      return jsonOut_({
        ok: true,
        updatedAt: new Date().toISOString(),
        total: afterDel.length,
        rows: afterDel
      });
    }

    if (action === 'SAVE_SETTINGS') {
      var s = saveSiteSettings_(body.settings || {});
      return jsonOut_({ ok: true, settings: s, updatedAt: new Date().toISOString() });
    }

    return jsonOut_({ ok: false, error: '未知操作 action: ' + action });
  } catch (err) {
    return jsonOut_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

