# CipherHub Beta · 暗号查询中心（测试版 · 三表实时同步）

- **测试版直达网址**：https://sorenskr.github.io/CipherHub-beta/
- **正式版直达网址**：https://sorenskr.github.io/CipherHub/
- **实时同步数据源（Google 在线表格）**：https://docs.google.com/spreadsheets/d/11HHwGX4lCUyHmBjcdrWhmGUtZsYmwlwoxIE4Qh_aKFU/edit?gid=0#gid=0

纯静态、零构建步骤（Live Server 可直接打开）的 Beta 测试版本，与正式版仓库共用同一个 Google 在线《暗号表》，实现 **总表 + 短链 + 团队** 三表打通实时同步。

## 1. 在线表格结构与同步规范

- **唯一准绳（「团队」工作表）**：以在线表格「团队」表第 3 行起的在册组员名单为准；表格里删除成员或暗号后，前端与云端总表/短链会同步剔除，不留旧数据。
- **「总表」规范**：表头 `A1 姓名 | B1 关键词 | C1 平台/模板`，固定按 `番号 → 聊天 → 走光 → 任务 → 新模版 → 备用 → 备用2 → 创新` 顺序排序。
- **「短链」规范**：表头 `A1 姓名 | B1 短链 | C1 地址`，前端卡片与成员名一一关联。

## 2. 目录结构（纯静态，无构建步骤）

- `index.html`：主页面（支持团队筛选、暗号/短链双向搜索、三表全量明细及内置管理后台）
- `css/style.css`：完整样式表
- `js/data.js`：默认配置及三表初始快照数据
- `js/sheet-sync.js`：三表实时同步引擎（Apps Script Web App 双向读写 + Google Sheets GViz 三表并行直连兜底）
- `js/app.js`：前台检索、团队筛选、一站式成员卡片与三表全量明细交互
- `js/admin.js`：内置管理后台（连点左上角 Logo 5 次进入，默认口令 `admin123`）
- `apps-script/Code.gs`：配套 Google Apps Script 云端脚本代码（含 `onEdit` 自动按团队清理联动）
