# 投资组合持仓分析工具 · 前端 UI 规格（供编码使用）

> 本文件是界面原型的结构化导出，供开发者与 AI 编程工具直接读取实现。
> 配套文件：`design-tokens.json`（设计令牌）、`types.ts`（前端数据契约）。
> 原型画布：https://claude.ai/artifact/9kdcMWS63QNzVZ1EF1DDNb
>
> **优先级约定**：业务口径以 docs/METHODOLOGY.md 为准；本文件只规定"界面长什么样、绑定什么数据、怎么交互"。
> 原型中的所有数字均为示意数据，实现时必须来自后端 API，不得写死。

---

## 0. 实现硬约束（AI 编码时必须遵守）

1. **数据驱动**：行业列表、行业数量、股票列表全部来自 API 返回，前端不得出现任何写死的行业名或股票代码。
2. **前端不做业务计算**：权重、主动权重、HHI、主动份额、重合度均由后端计算（6 位小数）。前端只做"展示格式化"（见第 5 节）。唯一例外：`等效持股数 = 1 / HHI`、行业内"贡献占比"这类纯展示派生值，可前端计算，并在代码中注释说明。
3. **不依赖外部网络**：字体、图表库全部本地打包，不使用 CDN。
4. **错误不泄露堆栈**：前端只展示后端统一错误结构里的 `message` 与 `details`；网络异常显示通用文案。
5. **方向不只靠颜色**：超配/低配必须同时显示 `▲/▼` 和 `+/−` 号。
6. **样式走令牌**：颜色、字号、间距从 `design-tokens.json` 映射为 CSS 变量，组件内不硬编码色值。

---

## 1. 全局布局（AppShell）

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar  [logo] 投研风控平台 / 组合持仓分析     [环境标签] [用户] │  56px, bg=brand.primary
├────────────┬─────────────────────────────────────────────────┤
│ SideNav    │ Main (padding 20px 28px 40px, 纵向 gap 16px)       │
│ 200~220px  │   PageHeader（面包屑 + H1 + 右侧操作按钮）          │
│ 白底+右边框 │   ...页面内容区块（Panel）                          │
└────────────┴─────────────────────────────────────────────────┘
```

- 页面底色 `surface.page`；内容区块统一为 **Panel**：白底、1px `border.panel`、圆角 4px。
- Panel 头部：`padding 14px 16px`，下边框 1px；标题 16px/600/`text.heading`；副说明 12px/`text.muted`。
- 响应式：外层 `display:flex; flex-wrap:wrap`；SideNav `flex:1 1 200px; max-width:220px`；Main `flex:999 1 560px; min-width:0`。窄屏时侧栏自动堆叠到上方。宽表格一律包在 `overflow-x:auto` 容器内。
- TopBar 右侧"环境标签"：金色描边小标签（原型显示「示意数据」，生产可显示「测试环境」/隐藏）。

### SideNav 菜单

| 分组 | 菜单项 | 路由 |
|---|---|---|
| 分析 | 组合体检 | `/` 或 `/analysis/:runId` |
| 分析 | 行业穿透 | `/analysis/:runId/industry/:industry` |
| 分析 | 多组合对比 | `/compare` |
| 管理 | 发起分析 / 校验 | `/runs/new` |
| 管理 | 分析记录 | `/runs` |

当前项样式：`bg=surface.navActive`，文字 `text.heading` 600，左侧 3px 内阴影 `brand.accent`（`box-shadow: inset 3px 0 0`）。

---

## 2. 页面规格

### 2.1 页面 01 · 组合体检（主看板）`/analysis/:runId`

覆盖全部基础分析项。组件树：

```
PageHeader
  breadcrumb: "分析 › 组合体检"
  title: "组合体检"
  actions: [导出 CSV(次按钮)] [生成体检报告(次按钮)] [重新分析(主按钮)]
ContextBar (Panel, 横向 flex-wrap)
  Select 组合      ← GET /api/portfolios
  Select 业绩基准  ← GET /api/benchmarks
  Text  持仓日期
  Link  分析编号 runId → /runs?highlight=runId
  Text  (右对齐) "组合 {portfolioCount} 只 · 基准 {benchmarkCount} 只 · 并集 {unionCount} 只"
KpiGrid (grid: repeat(auto-fit, minmax(200px,1fr)), gap 12px)
  KpiCard 前十大重仓权重  value=top10Weight      sub="最大单票 {maxStock.weight}（{maxStock.name}）"
  KpiCard 赫芬达尔指数HHI value=hhi(6位小数原样) sub="等效持股数 1/HHI ≈ {1/hhi 保留1位} 只"
  KpiCard 主动份额        value=activeShare      + ProgressBar(0~1)，两端标注"贴近基准 0"/"1 完全偏离"
  KpiCard 重合股票数      value=overlapCount 只  sub="两边权重均 > 0 的股票"
  KpiCard 重合权重        value=overlapWeight    sub=SelfCheck
IndustryComparePanel
TopMoversGrid (grid: repeat(auto-fit, minmax(420px,1fr)))
  ActiveWeightTable side=over   标题"个股超配 Top {N}"
  ActiveWeightTable side=under  标题"个股低配 Top {N}"  + 脚注
```

**SelfCheck 组件**：`|overlapWeight + activeShare − 1| < 1e-6` 时显示绿色对勾 +「自检：重合权重 + 主动份额 = 1.000000」；否则红色感叹号 +「自检未通过：合计 {sum}」。值使用 API 返回的 `selfCheck` 字段，或前端用两个已返回值相加判断。

**IndustryComparePanel**（核心图表，"超低配一目了然"）

- 头部右侧：图例（组合■ `chart.portfolio`、基准■ `chart.benchmark`、超配■、低配■）+ 排序切换按钮组 `[按主动权重][按组合权重]`（默认按主动权重降序；按下态 `aria-pressed=true`，背景 `brand.primary` 白字）。
- 副标题：`共 {industries.length} 个行业（由主数据 industry 字段生成）· 点击行业查看穿透明细`。
- 表格为 6 列 CSS grid：`120px | minmax(240px,1fr) | 80px | 80px | 240px | 90px`，最小宽度 860px，外层横向滚动。

| 列 | 内容 | 规则 |
|---|---|---|
| 行业 | `industry` | 500 字重 |
| 组合 vs 基准 | 两根上下排列的水平条，高 9px，间距 3px | 宽度 = 权重 / `scaleMax`；`scaleMax` = 所有行业组合/基准权重的最大值向上取整到 5% 的倍数（原型示意为 20%）。**不得写死 20%** |
| 组合 | 组合权重 % | 右对齐 |
| 基准 | 基准权重 % | 右对齐，`text.muted` |
| 主动权重条 | 以 50% 处为零线（1px `border.zeroLine`）的发散条，高 12px，轨道 `surface.barTrack` | 正值从零线向右，负值向左；半宽对应 `activeScaleMax` = max(\|active\|) 向上取整到 2% 倍数 |
| 主动权重 | `▲ +8.57%` / `▼ −10.66%` | 600 字重，方向色 |

- 整行可点击，跳转 `/analysis/:runId/industry/:industry`（用 `<a>`，保证键盘可达）。
- 面板脚注：`界面百分比保留 2 位；明细悬停与 CSV 导出保留 6 位小数原始口径。主动权重 = 行业组合权重 − 行业基准权重。`
- 悬停（tooltip / title）显示 6 位小数原值。

**ActiveWeightTable**

- 头部右侧 `Select 显示 [5|10|20]`，切换后重新请求 `GET /api/analyses/:runId/active-weights?side=over|under&top=N`。
- 列：股票（名称 500 字重 + 下方 12px 代码）｜行业｜组合｜基准｜主动权重（右对齐，方向色，带 ▲/▼）。
- 低配表：`portfolioWeight === 0` 的股票在名称后显示 **「仅基准」** 标签（`status.benchOnlyTag`）。表格底部固定脚注：`仅基准：组合未持有，组合权重记 0，仍计入并集与主动份额。`
- 超配表理论上可能出现"仅组合"股票（基准权重 0），可选显示「仅组合」标签，样式同 `bothHeldTag`。

### 2.2 页面 02 · 行业穿透（增强功能①）`/analysis/:runId/industry/:industry`

用户问题：行业超配了 X%，**来自哪几只股票**？

```
PageHeader  breadcrumb "组合体检 › 行业穿透"（组合体检可点击）
            title "行业穿透：{industry}"
            actions [返回体检(次按钮, 链接)] [导出本行业明细 CSV]
IndustryChips  横向可换行的胶囊按钮，每个显示 "行业名 ±主动权重"
               数据 = 当前分析的行业列表，按 |主动权重| 降序取前 7 + 一个"全部 N 个行业 ▾"下拉
               选中态：bg brand.primary，白字，aria-pressed=true；点击切换路由
IndustrySummary (grid auto-fit minmax(170px,1fr))
  行业组合权重 | 行业基准权重 | 行业主动权重(方向色) | 组合持有/基准成分 "6 / 21 只" | 超配主要来源 "{股票名} {贡献占比}"
IndustryHoldingsTable  标题 "行业内个股明细（组合 ∪ 基准）"
```

**IndustryHoldingsTable** 列：代码｜名称｜持有状态标签｜组合权重｜基准权重｜主动权重｜贡献条｜贡献占比。

- 持有状态：`共同持有`（两边均 >0）/`仅组合`/`仅基准`。
- 贡献占比 = 个股主动权重 ÷ 行业主动权重（前端派生，1 位小数，带符号）；全部行合计 100%。行业主动权重为 0 时显示 `—`，不得除零。
- 贡献条：零线位于条的 30% 处，正向占 70%、负向占 30%（因为正贡献通常更长）。
- 排序：默认按主动权重降序。
- 行数较多时：只在基准中出现、且组合未持有的成分股超过 5 只时，合并成一行"其余基准成分（展开）"，点击展开。
- 末行"行业合计"：2px 上边框，600 字重，数值与 IndustrySummary 一致。

### 2.3 页面 03 · 多组合对比（增强功能②）`/compare`

用户问题：风控巡检多个组合时，**谁偏离最大、谁最集中**？

```
PageHeader  title "多组合横向对比"
            actions [Select 统一基准] [+ 添加组合] [导出 CSV]
TwoColumn (grid auto-fit minmax(460px,1fr))
  PositioningChart  "偏离 × 集中 定位图"
  SelectedSummary   "选中组合：{name}"
ComparisonTable   "指标对比（同一基准）"
```

**PositioningChart**（散点图）

- X 轴 = 主动份额 0~100%；Y 轴 = HHI，0 ~ `ceil(maxHHI, 0.02)`（原型示意为 0.08，**不得写死**）。
- 绘图区高 300px，左边、下边 1px 轴线；50% 处纵横各一条虚线，形成四象限。右上角标签"高偏离 · 高集中"，左下角标签"贴近基准 · 分散"。
- 每个组合一个圆点（`<button>`，`aria-label=组合名`），旁边标注简称。默认 12px `chart.portfolio`；选中 18px `brand.accent`。
- 点击圆点或表格行 → 更新选中组合（页面内状态，同时写入 URL `?selected=`）。

**SelectedSummary**：2 列网格展示所选组合的 主动份额 / 重合权重 / HHI（+ 等效持股数）/ 前十大权重 / 最大超配行业 / 最大低配行业；底部按钮「打开该组合体检」→ 页面 01。

**ComparisonTable** 列：组合（色点 + 名称按钮）｜前十大权重｜HHI｜等效持股数｜主动份额（进度条 + 数值）｜重合股票数｜重合权重｜最大超配（方向色）｜最大低配（方向色）。选中行背景 `surface.rowSelected`。表头副说明：`每行均满足 重合权重 + 主动份额 = 100%`。

### 2.4 页面 04 · 发起分析 / 校验 / 分析记录 `/runs/new`、`/runs`

```
PageHeader title "发起分析 · 数据校验"
TwoColumn (grid auto-fit minmax(440px,1fr))
  AnalysisForm     "分析参数"
  ValidationPanel  "校验结果"
RunHistoryTable    "分析记录（计算留痕）"
```

**AnalysisForm**

| 字段 | 控件 | 校验（前端即时） |
|---|---|---|
| 组合持仓文件 | Select | 必选 |
| 业绩基准文件 | Select | 必选 |
| 个股排行 Top N | Input（inputmode=numeric） | 整数且 1 ≤ N ≤ 100；非法时：边框 `status.error.inputBorder`、背景 `inputBg`、下方红字「请输入 1–100 之间的整数」，并设置 `aria-invalid=true`；合法时显示灰字「将展示超配、低配各前 N 只」 |

- 下方信息框（`surface.subtle`）：`主数据：stock_info.csv · 已加载 {stockCount} 只 · {industryCount} 个行业` / `启动自检：{三个文件字段完整、数值可解析 | 具体错误}`，数据来自 `GET /api/health`。
- 按钮：`[开始分析](主)` `[仅校验](次)`。表单非法时主按钮 disabled。提交中显示 loading，防重复提交。

**ValidationPanel**

- 头部状态徽标：通过 → 绿色「校验通过」；未通过 → 红色「未通过 · {n} 处问题 · 已拒绝分析」。
- 列表 `role="alert"`：每条 = 红色圆形感叹号图标 + 标题（业务语言）+ 位置（文件 · 行号 · 代码 · 值）+「处理建议：…」。
- 规则 → 文案映射表（前端维护，未知 `rule` 则直接显示后端 `message`）：

| rule | 标题 | 处理建议 |
|---|---|---|
| `MARKET_VALUE_NON_POSITIVE` | 持仓市值必须为正数 | 剔除该行或修正市值后重新上传 |
| `DUPLICATE_STOCK_CODE` | 组合内股票代码重复 | 合并为一行（市值相加）或删除重复项 |
| `STOCK_NOT_IN_MASTER` | 股票不在主数据中 | 补充 stock_info.csv 中的名称与行业 |
| `BENCHMARK_WEIGHT_SUM_OUT_OF_RANGE` | 基准权重合计偏离 1 | 核对基准成分是否缺失 |
| `FIELD_MISSING` | 数据文件缺少必需字段 | 检查表头是否完整 |
| `VALUE_UNPARSEABLE` | 数值无法解析 | 检查该单元格格式 |
| `FILE_NOT_FOUND` | 数据文件缺失 | 确认文件已放入数据目录 |

- 底部 `<details>`：「查看接口返回（统一错误格式，开发排查用）」，展开为深色等宽代码块，显示 HTTP 状态行 + 格式化 JSON。

**RunHistoryTable**（`GET /api/analyses?status=&page=`）

列：分析编号（等宽字体）｜时间｜组合 / 基准（两行）｜输入指纹 SHA-256（`前4…后4 / 前4…后4`，等宽，悬停显示全文）｜主动份额｜耗时｜状态标签（成功/失败）+ 失败原因小字｜操作「查看」「加入对比」。头部右侧状态筛选 Select（全部/成功/失败）。失败记录的"查看"跳转到该次的校验详情。

---

## 3. 通用组件清单

| 组件 | 关键 props | 说明 |
|---|---|---|
| `AppShell` | `activeNav` | TopBar + SideNav + Main |
| `PageHeader` | `breadcrumb[]`, `title`, `actions` | |
| `Panel` | `title`, `subtitle`, `extra`, `footer` | 白底卡片容器 |
| `KpiCard` | `label`, `value`, `sub`, `children` | 数值 28px/600 |
| `DirectionValue` | `value:number(小数)`, `digits=2` | 输出 `▲ +x.xx%` / `▼ −x.xx%`，自动取方向色；0 显示 `0.00%` 灰色无箭头 |
| `DualBar` | `portfolio`, `benchmark`, `scaleMax` | 行业组合/基准双条 |
| `DivergingBar` | `value`, `scaleMax`, `zeroAt=0.5` | 主动权重发散条 |
| `Tag` | `variant: benchOnly|portOnly|both|success|error` | |
| `SegmentedControl` | `options`, `value`, `onChange` | 排序切换，使用 `aria-pressed` |
| `SelfCheck` | `overlapWeight`, `activeShare` | |
| `ErrorList` | `details[]` | ValidationPanel 内部使用 |
| `EmptyState` / `LoadingState` / `ErrorState` | | 见第 6 节 |

方向色读取全局设置 `directionScheme: 'aShare' | 'colorblindSafe'`（默认 `aShare`，可放在用户菜单里，存在 localStorage）。

---

## 4. 页面 → API 映射（建议，后端可调整命名）

| 页面区块 | 接口 |
|---|---|
| 发起分析 | `POST /api/analyses` body `{portfolioId, benchmarkId, topN}` → `AnalysisResult` 或 `ApiError` |
| 仅校验 | `POST /api/validations` body 同上 → `{valid:true}` 或 `ApiError` |
| 页面 01 全部 | `GET /api/analyses/:runId` → `AnalysisResult` |
| 行业分布 | `GET /api/analyses/:runId/industries` → `IndustryRow[]` |
| 个股排行 | `GET /api/analyses/:runId/active-weights?side=over|under&top=N` → `StockActiveRow[]` |
| 行业穿透 | `GET /api/analyses/:runId/industries/:industry/stocks` → `StockActiveRow[]` |
| 多组合对比 | `POST /api/comparisons` body `{benchmarkId, portfolioIds[]}` → `ComparisonRow[]` |
| 分析记录 | `GET /api/analyses?status=&page=&size=` → `Page<RunRecord>` |
| 导出 CSV | `GET /api/analyses/:runId/export?type=industry|active-weight` |
| 下拉数据 | `GET /api/portfolios`、`GET /api/benchmarks`、`GET /api/health` |

数据结构见 `types.ts`。**所有权重字段均为 0~1 小数（6 位精度），不是百分数。**

---

## 5. 数字格式化规则

| 场景 | 规则 | 示例 |
|---|---|---|
| 权重类展示 | `×100`，保留 2 位，加 `%` | 0.184200 → `18.42%` |
| 主动权重展示 | 同上 + 符号 + 箭头；负号用 `−`(U+2212) | −0.106600 → `▼ −10.66%` |
| HHI | 原样 6 位小数，不转百分比 | `0.048213` |
| 等效持股数 | `1/HHI` 保留 1 位 | `20.7` |
| 计数 | 千分位 | `5,214` |
| tooltip / CSV | 原始 6 位小数 | `0.184200` |

统一放在 `utils/format.ts`：`fmtPct(v, digits=2)`、`fmtActive(v)`、`fmtHhi(v)`、`fmtInt(n)`。格式化只用于展示，**不得把格式化结果再参与计算**。

---

## 6. 状态设计（每个数据区块都要有）

| 状态 | 表现 |
|---|---|
| 加载中 | Panel 内骨架条（灰色 `surface.progressTrack`），KPI 显示 `—` |
| 空数据 | Panel 内居中灰字，如「暂无分析记录，去 发起分析」 |
| 接口业务错误（4xx） | 页面顶部红色提示条：`{message}`，可展开 `details` |
| 服务器/网络错误 | 「服务暂时不可用，请稍后重试」+ 重试按钮；**不显示任何堆栈或原始异常** |
| 校验失败 | 页面 04 的 ValidationPanel 展示 |

---

## 7. 可访问性与交互细节

- 可点击元素一律用 `<a>` 或 `<button>`，不要给 div 绑 onClick。
- 仅图标的按钮必须有 `aria-label`；装饰性 SVG 加 `aria-hidden="true"`。
- 表单 `<label>` 与输入框关联；错误提示通过 `aria-describedby` 关联。
- 正文与背景对比度 ≥ 4.5:1（令牌中的 `text.muted` #5B6573 在白底满足要求，不要再调浅）。
- 按钮高度 36px（主操作 40px），可点击区域足够。

---

## 8. 验收清单（实现完成后逐项自查）

- [ ] 换一套数据文件，行业数量与名称自动变化，界面无写死内容
- [ ] 行业表能一眼看出超配/低配（发散条 + 方向色 + 箭头）
- [ ] 低配表正确标出「仅基准」股票
- [ ] KPI 区 5 个指标齐全，自检显示通过
- [ ] Top N 输入 0、101、abc、空值 都有提示，主按钮禁用
- [ ] 4 类业务错误在 ValidationPanel 以业务语言展示
- [ ] 断开后端时界面不崩溃、无堆栈
- [ ] 切换方向色方案后，所有页面同步生效
- [ ] 窄屏下侧栏堆叠，宽表格横向滚动
