# 风电叶片巡检缺陷标注台（gbwindblade）

面向风电场运维班组的叶片巡检与检修人员：把无人机 / 望远镜巡检发现的叶片缺陷按**展向分段**逐条落档，并派发维修工单直到闭环验收。

核心动作：**建立机组与叶片台账 → 划分展向分段并挂接剖面图 → 标注缺陷类型与尺寸面位 → 派发维修工单 → 导出巡检报告**。

纯前端单页应用（Vue 3 + TypeScript + Element Plus + Vite + Pinia + Vue Router + Dexie），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB 库名 `gbwindblade`，另有少量 localStorage 元数据），刷新或重启浏览器后依然存在。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22801**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbwindblade}-frontend`。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地；迁移设备请使用应用内「报告与导出」页的导出 / 导入 JSON。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Vue 3（`<script setup>` + Composition API） | 页面与组件全部使用组合式 API |
| 语言 | TypeScript（`strict: true`） | `npm run build` 内含 `vue-tsc --noEmit` 类型检查，零错误 |
| UI 组件库 | Element Plus 2.x（含 `@element-plus/icons-vue`） | 表格、对话框、步骤流转、上传、折叠面板等交互 |
| 构建工具 | Vite 6 | 开发服务器端口 22801 |
| 状态管理 | Pinia（setup store） | `turbineStore` / `bladeStore` / `defectStore` / `workOrderStore` |
| 路由 | Vue Router 4（history 模式） | nginx 侧用 `try_files $uri $uri/ /index.html` 做 SPA fallback |
| 本地存储 | Dexie 4（IndexedDB 封装）+ localStorage | 含数据结构版本号与 `upgrade` 升级迁移逻辑 |
| 容器化 | Docker 多阶段构建：`node:20-alpine` → `nginx:alpine` | 构建阶段执行类型检查与打包，运行阶段仅托管静态产物 |

---

## 三、页面与路由

| 路由 | 页面 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/turbines` | 机组合账 | Turbine、Blade、Defect | 新建机组并**按叶片数派生叶片记录**、按机型 / 投运年份筛选、卡片回显缺陷总数与未闭环数、编辑时同步增删叶片、级联删除 |
| `/blades/:id/segments` | 叶片分段与剖面 | Blade、Segment、Defect | 叶片切换、**按段数批量生成展向分段**、单段新增 / 编辑 / 删除、上传剖面图（本地预览）、按检修面查看段内缺陷、行内改状态 |
| `/defects` | 缺陷标注台 | Defect、Segment | 按机组 / 类型 / 程度 / 面位 / 状态组合筛选（同步 URL query）、单条标注、勾选后批量改等级 / 改类型 / 改状态、批量派工、批量删除 |
| `/workorders` | 维修工单 | WorkOrder、Defect | 按班组与状态筛选、派工建单、限期跟催（超期高亮）、状态流转 `待派 → 处理中 → 待验收 → 已闭环`、验收回写缺陷为已修复、撤回验收、删除后同步缺陷状态 |
| `/report` | 报告与导出 | 全部模型 | 按机组生成巡检报告预览（分级分布、分段明细、工单跟踪）、查看数据结构版本、导出报告 / 全量备份 JSON、导入 JSON（覆盖 / 合并 / 追加）、清空与重新播种 |

---

## 四、本地开发方式

```bash
cd frontend
npm install
npm run dev        # 开发服务器 http://localhost:22801
npm run build      # 类型检查 + 生产构建，产物在 frontend/dist
npm run preview    # 本地预览构建产物（http://localhost:22801）
```

> 首次打开页面会自动播种演示数据（幂等，只在机组表为空时执行）：
> **2 台机组 × 各 2 片叶片 × 各 3 个展向分段 × 18 条缺陷 × 4 张工单**，5 个页面打开即有内容。

---

## 五、目录结构

```
sologsb101-1001/
├── docker-compose.yml            # name: gbwindblade；服务 frontend；22801 → 80；无 version、无命名卷
├── .env / .env.example           # COMPOSE_PROJECT_NAME=gbwindblade、FRONTEND_PORT=22801
├── .gitignore
├── README.md
└── frontend/
    ├── Dockerfile                # node:20-alpine 构建 → nginx:alpine 托管（含 chmod -R a+rX 修正产物权限）
    ├── nginx.conf                # SPA fallback + gzip + 静态资源缓存
    ├── .dockerignore
    ├── package.json / tsconfig.json / tsconfig.node.json / vite.config.ts / index.html
    ├── public/favicon.svg
    └── src/
        ├── main.ts               # 挂载前先 ensureSeeded()，避免首屏空白
        ├── App.vue               # 顶部导航（5 个路由 + 数量徽标）、底部数据存储说明
        ├── styles/main.css
        ├── types/                # turbine.ts blade.ts segment.ts defect.ts workOrder.ts
        ├── stores/               # turbineStore.ts bladeStore.ts defectStore.ts workOrderStore.ts
        ├── hooks/                # useDefectFilter.ts useIdbTable.ts
        ├── components/common/    # SeverityTag.vue FilterBar.vue StatBadge.vue EmptyPanel.vue
        ├── utils/                # db.ts severity.ts report.ts export.ts
        ├── pages/                # TurbineList.vue BladeSegment.vue DefectBoard.vue WorkOrderList.vue ReportView.vue
        └── router/index.ts       # /turbines、/blades/:id/segments、/defects、/workorders、/report
```

分层约定：**页面只读 store，跨页状态不放组件内部 state**；`types/` 定义实体与筛选条件，`stores/` 维护列表与派生统计，`hooks/` 封装 Dexie 订阅与缺陷筛选派生值，`utils/` 提供持久化、单位换算与报告导出。

---

## 六、数据存储说明

| 项目 | 说明 |
| --- | --- |
| 库名 | IndexedDB `gbwindblade`（Dexie 封装） |
| 结构版本 | `DB_VERSION = 2`，`utils/db.ts` 内含版本号与 `upgrade` 迁移（补全缺陷状态、工单验收字段、分段剖面图字段） |
| 对象表 | `turbines`、`blades`、`segments`、`defects`、`workOrders`，均按 `id` 主键 + 外键索引 |
| 级联关系 | 机组 → 叶片 → 展向分段 → 缺陷 → 维修工单；删除上级会级联清理下级记录 |
| localStorage | `gbwindblade:ui-prefs`（上次查看的机组 / 叶片）、`gbwindblade:db-version`、`gbwindblade:last-backup-at` |
| 备份 | 「报告与导出」页可导出 / 导入 JSON，导入支持覆盖、按 id 合并、追加（重新分配 id）三种方式 |
| 演示数据 | 首次进入自动播种，幂等；也可在页面空状态点击「生成演示数据」或报告页「重新播种演示数据」 |

> 数据不会上传到任何服务器；换浏览器或清理浏览器数据会导致本地记录丢失，请及时导出 JSON 备份。
