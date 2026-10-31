/**
 * CipherHub Beta · 默认配置与初始一维表格数据
 *
 * 【表格列定义（与在线表格 1:1 严格对应）】
 *   - A1: 姓名   (name)
 *   - B1: 关键词 (keyword)
 *   - C1: 模板   (template)
 *
 * 【固定模板排列顺序（从上往下拼接）】
 *   先放完「番号」表所有人，再放「聊天」表的，接着是「对比、任务、新模版、备用、备用 2」，不会乱。
 */
(function () {
  'use strict';

  // 可在此处直接填入默认绑定的 Apps Script 部署链接或 Google 表格链接，
  // 也可直接进入网页后台（连点左上角 Logo 5 次）在「在线表格绑定」中可视化配置并保存。
  window.CH_BETA_CONFIG = {
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbzpDj5o-QmlnU2xtWSGoVc9hyk78tR2JDvnLQ8XMDVNGHSy3UlIw_L_CBEaciIDfTgg/exec', // 例如：https://script.google.com/macros/s/AKfycb.../exec
    sheetUrl: '',      // 例如：https://docs.google.com/spreadsheets/d/1xxxx.../edit
    sheetName: '',     // 留空默认读取「总表」或首个含 A1=姓名 的工作表
    adminPass: 'admin123',
    autoSyncSec: 30    // 绑定在线表格后，前台自动轮询同步间隔（秒），0 表示仅打开/切回页面时同步
  };

  // 严格固定的 7 大模板顺序
  window.TEMPLATE_ORDER = ['番号', '聊天', '对比', '任务', '新模版', '备用', '备用 2'];

  window.TEMPLATES = [
    { id: 'fanhao',   name: '番号',   short: '番',  color: '#7c5cff', order: 1 },
    { id: 'liaotian', name: '聊天',   short: '聊',  color: '#00c8b4', order: 2 },
    { id: 'duibi',    name: '对比',   short: '对',  color: '#ff7a59', order: 3 },
    { id: 'renwu',    name: '任务',   short: '任',  color: '#3ea6ff', order: 4 },
    { id: 'xinmoban', name: '新模版', short: '新',  color: '#e1306c', order: 5 },
    { id: 'beiyong',  name: '备用',   short: '备',  color: '#ffb020', order: 6 },
    { id: 'beiyong2', name: '备用 2', short: '备2', color: '#8b93a7', order: 7 }
  ];

  window.TEMPLATE_ALIAS = {
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

  // 内置高清 SVG Logo（保证纯静态任何目录打开均不裂图）
  var SVG_LOGO_1 = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
    '<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#7c5cff"/><stop offset="55%" stop-color="#3ea6ff"/><stop offset="100%" stop-color="#ff5c8a"/>' +
    '</linearGradient></defs>' +
    '<rect width="120" height="120" rx="28" fill="url(#g1)"/>' +
    '<path d="M44 30L34 90M86 30L76 90M26 48h70M22 72h70" stroke="#fff" stroke-width="9" stroke-linecap="round"/>' +
    '</svg>'
  );

  var SVG_LOGO_2 = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
    '<defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#00c8b4"/><stop offset="100%" stop-color="#7c5cff"/>' +
    '</linearGradient></defs>' +
    '<rect width="120" height="120" rx="28" fill="url(#g2)"/>' +
    '<circle cx="54" cy="54" r="22" fill="none" stroke="#fff" stroke-width="9"/>' +
    '<path d="M70 70l20 20" stroke="#fff" stroke-width="9" stroke-linecap="round"/>' +
    '</svg>'
  );

  // 初始内置示例数据（未绑定在线表格或离线时展示；一旦绑定在线表格，实时以在线表格 A/B/C 列数据为准）
  // 严格按顺序：番号 → 聊天 → 对比 → 任务 → 新模版 → 备用 → 备用 2
  window.DEFAULT_DATA = {
    updatedAt: '2026-10-31T19:00:00.000Z',
    settings: {
      siteName: '暗号查询中心 Beta',
      subtitle: '支持按姓名正查名下全部关键词，或输入暗号关键词反查归属人',
      logos: [SVG_LOGO_1, SVG_LOGO_2],
      groups: ['Laya'],
      feedback: {
        title: '问题反馈',
        desc: '查不到、关键词有误、需要新增 —— 都可以直接留言告诉我们',
        enableForm: true
      },
      contacts: []
    },
    rows: [
      // 1. 番号
      { name: '周政霖', keyword: 'FH-1024', template: '番号' },
      { name: '周纯',   keyword: 'FH-1088', template: '番号' },
      { name: '周川东', keyword: 'FH-1102', template: '番号' },
      { name: '赵蕊',   keyword: 'FH-1156', template: '番号' },
      { name: '张小聪', keyword: 'FH-1209', template: '番号' },
      { name: '袁斌',   keyword: 'FH-1266', template: '番号' },
      // 2. 聊天
      { name: '周政霖', keyword: 'LT-8801', template: '聊天' },
      { name: '周纯',   keyword: 'LT-8802', template: '聊天' },
      { name: '易琦琦', keyword: 'LT-8820', template: '聊天' },
      { name: '姚杰伟', keyword: 'LT-8835', template: '聊天' },
      { name: '吴子倩', keyword: 'LT-8851', template: '聊天' },
      // 3. 对比
      { name: '周政霖', keyword: 'DB-301',  template: '对比' },
      { name: '吴玉婷', keyword: 'DB-312',  template: '对比' },
      { name: '邬开洋', keyword: 'DB-328',  template: '对比' },
      { name: '万哲宇', keyword: 'DB-339',  template: '对比' },
      // 4. 任务
      { name: '宋磊',   keyword: 'RW-501',  template: '任务' },
      { name: '秦雨蝶', keyword: 'RW-508',  template: '任务' },
      { name: '牛晓雨', keyword: 'RW-516',  template: '任务' },
      { name: '聂志文', keyword: 'RW-529',  template: '任务' },
      // 5. 新模版
      { name: '慕杰',   keyword: 'XM-701',  template: '新模版' },
      { name: '闵智芳', keyword: 'XM-709',  template: '新模版' },
      { name: '马豫鄂', keyword: 'XM-718',  template: '新模版' },
      { name: '马宇航', keyword: 'XM-726',  template: '新模版' },
      // 6. 备用
      { name: '罗东',   keyword: 'BY-901',  template: '备用' },
      { name: '卢婉静', keyword: 'BY-905',  template: '备用' },
      // 7. 备用 2
      { name: '娄慧珍', keyword: 'BY2-001', template: '备用 2' },
      { name: '袁斌',   keyword: 'BY2-008', template: '备用 2' }
    ]
  };
})();

