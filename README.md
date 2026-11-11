# 投资组合持仓分析工具 · Portfolio Holdings Analyzer

![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB) ![FastAPI](https://img.shields.io/badge/FastAPI-009688) ![React](https://img.shields.io/badge/React-19-61DAFB) ![License: MIT](https://img.shields.io/badge/License-MIT-green)

> **English summary** — A full-stack tool that gives an equity portfolio a "health check" against a benchmark index:
> industry allocation and over/underweights, concentration (top-10 weight, HHI), per-stock active weights,
> active share and overlap. It ships a pure-Python analysis engine, a FastAPI service with audit trail (SQLite),
> and a React + TypeScript web UI with industry drill-down and multi-portfolio comparison.
> All sample data is synthetic. Calculation rules are documented in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

给股票组合做“体检”：行业分布与超低配、集中度（前十大 / HHI）、个股主动权重、主动份额、重合度。
包含 **分析引擎 + HTTP 分析服务 + Web 分析界面**，计算口径见 [docs/METHODOLOGY.md](docs/METHODOLOGY.md)。

- 后端：Python 3.11+（已在 3.14 验证）· FastAPI · SQLite（标准库）· 引擎为纯 Python，无 pandas/numpy 依赖
- 前端：React 19 · TypeScript · Vite（无图表库依赖，条形 / 散点按 `ui-spec` 用 CSS 绘制；不依赖任何 CDN）

---

## 1. 快速开始（干净环境）

```bash
# 1) 后端依赖
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt          # Windows: .venv\Scripts\pip

# 2) 前端构建（Node 20+）
cd ../frontend
npm install
npm run build                                        # 产物在 frontend/dist，由后端直接托管

# 3) 启动（一条命令，前后端同端口）
cd ../backend
.venv/bin/python -m app --port 8000
# 浏览器打开 http://127.0.0.1:8000
# API 文档（OpenAPI）：http://127.0.0.1:8000/docs
```

前端开发模式（热更新）：后端照常启动后，`cd frontend && npm run dev`，打开 http://localhost:5173（`/api` 自动代理到 8000）。

### 运行测试

```bash
cd backend
.venv/bin/python -m pytest          # 107 个用例（含 37 个边界场景），约 2 秒
```

### 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PA_DATA_DIR` | `<项目>/data` | 数据目录 |
| `PA_DB_PATH` | `backend/var/history.db` | 留痕数据库 |
| `PA_FRONTEND_DIST` | `frontend/dist` | 前端产物目录（不存在则只提供 API） |

---

## 2. 目录与数据

```
data/
  stock_info.csv              主数据（stock_code, stock_name, industry）——全局唯一
  portfolios/*.csv            预置组合（stock_code, market_value），文件名即组合 id
  benchmarks/*.csv            预置基准（stock_code, weight），benchmark.csv 为默认基准
backend/app/
  domain/      领域模型、统一错误类型与错误码
  loaders/     CSV 解析与校验（只管 I/O，不含口径）
  engine/      analyzer.py 分析口径（纯计算）；rounding.py 统一在输出时舍入
  repo/        registry.py 数据源注册表；history.py SQLite 留痕
  service.py   编排：加载 → 校验 → 分析 → 留痕
  api/         路由与统一异常处理
backend/tests/ 引擎 / 加载 / API / 性能测试；fixtures/ 默认数据的参考答案
backend/scripts/  gen_sample.py 默认示例数据 + 参考答案；gen_portfolios.py 演示组合；gen_boundary_cases.py 边界场景；gen_stress.py 压测数据；benchmark_perf.py 性能测试
docs/          METHODOLOGY.md 计算口径与校验规则
frontend/src/  styles/tokens.css 设计令牌；router.ts 哈希路由；pages/ 四类页面（组合体检、行业穿透、多组合对比、分析记录、数据与校验）；components/ 通用组件
ui-spec/       界面规格（细节取舍见第 7 节）
```

**更多演示组合**：`cd backend && .venv/bin/python scripts/gen_portfolios.py` 会在 `data/portfolios/` 生成 6 个特征鲜明的组合（指数增强、高集中度、行业主题、等权分散、前十大并列边界、复制基准），并在 `samples/invalid/` 生成 6 个非法样例供界面上传测试。股票均取自主数据，固定随机种子，可复现。

`data/` 下的默认示例数据（300 只虚构股票、12 个行业）由 `backend/scripts/gen_sample.py` 以固定种子生成，同时生成 `backend/tests/fixtures/expected_*` 参考答案（独立的 `Fraction` 精确实现），只被测试读取。
**换一套验收数据**：替换 `data/stock_info.csv`、`data/portfolios/`、`data/benchmarks/` 下的文件后重启即可；也可以在界面或 API 上传。

---

## 3. 计算口径（实现要点）

全部在 `backend/app/engine/analyzer.py`，与数据加载完全解耦（输入是领域对象，不碰文件）。

| 指标 | 实现 |
|---|---|
| 组合权重 | 持仓市值 ÷ 组合总市值（`math.fsum` 求和，减少浮点累积误差） |
| 并集 | 组合 ∪ 基准；只在组合里的基准权重记 0，只在基准里的组合权重记 0 |
| 行业分布 | 遍历一次并集，按主数据行业字段累加；**行业清单完全来自数据**，代码中没有任何行业名 |
| 前十大权重 | 按（权重降序, 代码升序）排序取前 10 求和；不足 10 只取全部 |
| HHI | Σ wᵢ² |
| 个股主动权重 | 组合权重 − 基准权重；输出按主动权重降序、代码升序 |
| 主动份额 | 0.5 × Σ\|wp − wb\|（并集上） |
| 重合 | 重合股票数 = 两边权重都 > 0 的股票数；重合权重 = Σ min(wp, wb)；同时输出 `overlap_plus_active_share` 自检 |
| 精度 | 中间全程不舍入；仅在序列化时用 `Decimal` 四舍五入（ROUND_HALF_UP）保留 6 位 |

**超配 / 低配 Top N**：超配取主动权重 > 0，按降序排；低配取主动权重 < 0，按升序排（低配最多的在前）；并列时都按代码升序。

持仓和基准成分身份通过 `is_held`、`is_benchmark_constituent` 明确记录；权重舍入为零不会改变身份。个股 `active_side` 与各方向的 `active_rank` 在舍入前计算，API 和界面直接使用这些字段筛选与排名，并随历史结果持久化。

旧版历史结果仍可查看，持仓身份回退为按市值判断；缺少原始精度排名及基准成分标记时，界面提示重新分析，排行接口返回 409，不从已舍入数值推测原始排名。

**实现上的约定**：
- 基准权重合计偏离 1 不超过 ±0.01：**按原值计算，不归一化**，结果带 `warnings` 和 `benchmark_weight_sum`。这时“重合权重 + 主动份额”可能不严格等于 1，界面会提示；超出容差则拒绝。
- 股票代码按字符串处理，保留前导 0。CSV 支持 UTF-8（含 BOM）和 GBK 编码。

---

## 4. HTTP API

统一错误格式（任何情况下都不返回堆栈）：

```json
{"error": {"code": "NON_POSITIVE_MARKET_VALUE", "message": "测试组合：持仓市值必须为正数（共 1 处）",
           "details": [{"line": 3, "stock_code": "600001", "market_value": -1.0}]}}
```

| 方法 & 路径 | 说明 |
|---|---|
| `GET  /api/portfolios` / `GET /api/benchmarks` | 数据源列表，包括可用状态（ok/invalid）、不可用原因、行数、SHA-256 |
| `POST /api/portfolios` | 用 JSON 提交持仓 `{"name","holdings":[{"stock_code","market_value"}]}` |
| `POST /api/portfolios/upload` / `POST /api/benchmarks/upload` | multipart 上传 CSV（`file`, 可选 `name`） |
| `POST /api/analyses` | **执行分析** `{"portfolio_id","benchmark_id"?,"top_n"?}`（`top_n` 1–100，默认 10，作为排行展示参数存档），返回全部结果并留痕；校验未通过时返回 422 并留下一条失败记录 |
| `POST /api/validations` | **仅校验** `{"portfolio_id","benchmark_id"?}`：同时检查组合与基准，通过返回 `{"valid":true,…}`，否则 422 `VALIDATION_FAILED` 并逐条列出问题；不留痕 |
| `GET  /api/analyses/{id}` | 取回某次分析的完整结果 |
| `GET  /api/analyses/{id}/industries` | 行业分布（组合 / 基准 / 主动权重） |
| `GET  /api/analyses/{id}/active-weights?side=over\|under\|all&top=N&industry=` | 超配 / 低配 Top N 排行 |
| `GET  /api/analyses/{id}/export?type=industry\|active` | 导出 CSV（UTF-8 BOM，Excel 直接打开） |
| `POST /api/comparisons` | **多组合对比同一基准** `{"portfolio_ids":[…2~10],"benchmark_id"?}` |
| `GET  /api/history?limit=&offset=&portfolio_id=&status=success\|failed` | 留痕历史（含失败记录的错误码与原因） |
| `GET  /api/meta` | 主数据规模、行业清单与行业数（来自数据）、默认基准 |

```bash
curl -s -X POST localhost:8000/api/analyses -H 'Content-Type: application/json' \
     -d '{"portfolio_id":"portfolio","benchmark_id":"benchmark"}'
curl -s 'localhost:8000/api/analyses/<id>/active-weights?side=under&top=5'
curl -s -X POST localhost:8000/api/comparisons -H 'Content-Type: application/json' \
     -d '{"portfolio_ids":["portfolio","<另一个组合id>"]}'
```

### 错误码

| 场景 | HTTP | code |
|---|---|---|
| 持仓市值为负或为零 | 422 | `NON_POSITIVE_MARKET_VALUE` |
| 组合（或基准）内股票代码重复 | 422 | `DUPLICATE_STOCK_CODE` |
| 股票在主数据中缺失 | 422 | `UNKNOWN_STOCK` |
| 基准权重合计偏离 1 超过 ±0.01 | 422 | `BENCHMARK_WEIGHT_SUM_INVALID` |
| 基准权重为负 | 422 | `NEGATIVE_BENCHMARK_WEIGHT` |
| 数据文件缺少必需字段 | 422 | `FIELD_MISSING` |
| 数值缺失或无法解析（含 NaN/Inf） | 422 | `VALUE_UNPARSEABLE`（带行号、代码、字段、原值） |
| 数据文件不存在 | 422 | `FILE_NOT_FOUND` |
| 空文件、编码无法识别、CSV 格式错误、股票代码为空、数据行列数多于表头（如未加引号的 `1,000`） | 422 | `INVALID_FILE` |
| 组合没有持仓 | 422 | `EMPTY_PORTFOLIO` |
| 用不合规的组合 / 基准发起分析、校验或对比 | 422 | `VALIDATION_FAILED`：`details` 为逐条问题 `{rule, source, file, message, line?, stock_code?, …}`，`rule` 即上面各行的错误码 |
| 对失败的分析记录查询行业 / 排行 / 导出 | 409 | `VALIDATION_FAILED` |
| 组合、基准或分析记录不存在 | 404 | `NOT_FOUND` |
| 请求体不合法、参数越界 | 400 | `BAD_REQUEST` |
| 上传文件超过 20MB | 413 | `BAD_REQUEST` |
| 未预期异常 | 500 | `INTERNAL_ERROR`（堆栈只写服务端日志） |

### 数据容错策略

- **主数据 `stock_info.csv` 缺失或损坏 → 拒绝启动**。进程打印 `[启动失败] 主数据不可用：…`（带行号），退出码 1。
- **某个预置组合或基准文件损坏 → 拒绝用它分析**。启动时标为 `invalid` 并记下原因，在“数据与校验”页可以逐条查看；用到它的分析返回 422 `VALIDATION_FAILED`，同时留下一条失败记录，其他数据源不受影响。
- **上传的数据不合规 → 直接拒绝**，不入库。

### 计算留痕

每次分析都写入 SQLite 表 `analysis_runs`：
- 输入标识：组合 / 基准的 id、名称，以及组合、基准、主数据三个文件的 **SHA-256 指纹**
- 分析时间、耗时、参数（Top N）
- 状态：成功记录保存完整结果 JSON；**失败记录**保存错误码、原因与逐条问题（数据库为旧版时启动自动补列）

上传的组合 / 基准原文存在 `uploads` 表，重启后仍可用。可以通过 `/api/history` 和 `/api/analyses/{id}` 追溯任一次分析。

---

## 5. 性能

**要求**：组合与基准各 5,000 只股票，一次完成全部指标分析 < 2 秒。

**实现**：先用字典建索引，再对并集**只遍历一次**，同时累计个股主动权重、行业汇总、主动份额和重合度，整体是 O(n log n)（排序占主要部分）。不存在“每只股票扫一遍全表”的做法。

**复现方法**：

```bash
cd backend
.venv/bin/python scripts/gen_stress.py            # 生成 ../data_stress：主数据 10000 只，30 个行业；组合 5000、基准 5000，约半数重叠
.venv/bin/python scripts/benchmark_perf.py        # 各重复 20 次，报告中位数和最大值
.venv/bin/python -m pytest tests/test_perf.py     # 自动化断言 < 2s
```

**实测结果**（AMD Ryzen 7 4800H，WSL2，Python 3.14）：

| 项目 | 中位数 | 最大值 |
|---|---|---|
| 引擎 `analyze()` + 结果舍入序列化（并集 7789 只） | 55 ms | 67 ms |
| 端到端 `POST /api/analyses`（含校验、计算、序列化、SQLite 落库） | 96 ms | 160 ms |
| 启动时加载并校验三个 CSV（一次性） | 63 ms | — |

也可以 `PA_DATA_DIR=../data_stress .venv/bin/python -m app`，在界面里直接分析压测组合。

---

## 6. 测试覆盖

### 边界条件测试数据

```bash
cd backend
.venv/bin/python scripts/gen_boundary_cases.py      # 生成 ../samples/boundary/ 下 37 个场景
.venv/bin/python -m pytest tests/test_boundary_cases.py
PA_DATA_DIR=../samples/boundary/03_top10_tie_at_boundary .venv/bin/python -m app   # 任一场景都可在界面里查看
```

每个场景是一套完整的数据目录（主数据 + 组合 `p` + 基准 `b`）加 `expected.json`。预期结果由脚本内一份**独立的参考实现**算出：全程用 `fractions.Fraction` 精确计算，只在最后四舍五入到 6 位，与被测引擎（浮点）互不依赖。每个场景另有人工写明的断言，用来反过来检查参考实现本身。

| 类别 | 场景 |
|---|---|
| 口径边界（15） | 文档示例；只在基准里的股票 / 整个行业组合未持有；前十大第 9~12 名并列（倒序写入）；15 只等权；不足 10 只；单只持仓（HHI = 1）；与基准完全一致（主动份额 0）；与基准无交集（主动份额 1）；四舍五入边界 0.0000005 → 0.000001 和 0.9999995 → 1.000000；权重舍入为 0 但仍持有；基准中权重为 0 的成分；基准合计 0.99 / 1.01（容差端点）；超大 / 小数 / 科学计数法市值；文件格式（GBK、BOM、CRLF、空行、多余列、列顺序颠倒、空格、代码前导 0） |
| 非法组合 / 基准（18） | 市值为 0 / 负；代码重复；不在主数据；缺列；无法解析；空值；NaN；inf；只有表头；空文件；代码为空；**列数多于表头**；基准合计 0.989999 / 1.010001；基准权重为负；基准代码重复；基准成分不在主数据 |
| 非法主数据（4） | 文件缺失；行业为空；代码重复；缺列——均应拒绝启动 |

这套数据发现并修复了一个问题：CSV 中未加引号的千分位数字（如 `600001,1,000`）会被拆成多列，原先多出的列被静默丢弃，市值被读成 `1`。现在列数多于表头的行一律拒绝，并报出行号（行尾空列仍然容忍）。

### 其他测试

- **对照参考答案**（`tests/fixtures`）：行业分布、个股主动权重（包括排序）、全部汇总指标，误差 < 1e-6
- **边界场景**：
  - 只在基准里的股票计入并集和行业汇总
  - 前十大权重并列时按代码升序
  - 不足 10 只股票
  - 重合权重 + 主动份额 = 1
  - 组合与基准完全相同（主动份额 0、重合权重 1）
  - 单只股票 HHI = 1
  - 行业清单由数据驱动
  - 四舍五入边界（0.0000005 → 0.000001），以及中间不提前舍入
- **容错**：
  - 各错误码，并断言响应里没有 `Traceback`
  - 未预期异常不泄露内部信息
  - 主数据缺失或损坏时拒绝启动（子进程验证退出码）
  - 损坏的预置文件被标为 invalid 并拒绝分析；仅校验接口汇总组合与基准两侧的问题
  - 失败的分析留痕、可按状态筛选；旧版数据库自动迁移
  - GBK 和 BOM 编码
- **API**：分析、子资源查询、导出、上传（JSON / CSV）、重启后留痕和上传仍在、多组合对比

---

## 7. 产品设计说明

### 目标用户是谁

- **投研人员（基金经理、研究员）**：关心“我和基准差在哪”。超配了哪些行业？这些超配由哪几只股票带来？没买的权重股有哪些？
- **风控 / 合规人员**：关心“组合是否过度集中、是否偏离基准”。他们要定期检查多只产品，并在同一口径下横向比较。
- **使用场景**：定期复盘、调仓前后对比、风控例行检查、同类产品横评。结论要能交给别人看，要能追溯。

### 基础能力

- 指标卡：前十大 / HHI（附“等效持股数 1/HHI”，更直观）/ 主动份额 / 重合股票数 / 重合权重。每项都显示 6 位原值，并给出“重合权重 + 主动份额 = 1”的自检。
- 行业分布：一张表里每个行业一行，组合 / 基准双条并列 + 以零线居中的主动权重发散条 + `▲ +x.xx%` / `▼ −x.xx%`；可按主动权重或组合权重排序；比例尺由数据决定，不写死。
- 超配 / 低配 Top N 两表并排，每表可切换 5 / 10 / 20；低配表标出“仅基准”（组合未持有）的股票。
- 页面分工：**组合体检只负责看结果**，顶部可快速切换组合 / 基准重新分析；**数据与校验页负责管数据**，包括上传、仅校验、Top N 参数、查看失败原因。体检页有“上传 / 校验数据”入口，分析被拒时有“查看校验详情”按钮，会带上所选数据跳到校验页并自动校验。数据问题只在校验页这一处展示。
- 数据与校验页：Top N 输入（1–100）非法时就地提示并禁用“开始分析”；“仅校验”把后端问题按规则翻译成业务语言 + 处理建议，原始错误 JSON 可展开查看。
- 持仓明细：全部持仓的组合权重（及持仓市值、基准权重、主动权重），可搜索、按行业筛选、点表头排序、分页；可切换为含未持有基准成分的并集。
- 上传组合 / 基准：前端先检查文件类型、大小、表头，后端校验的错误精确到行号、代码和字段。

### 增强功能

**① 行业超低配发散条 + 行业穿透页**

- 行业表的发散条以零线居中：超配向右、低配向左。一眼就能看到哪些行业偏离最大、偏离方向如何。
- 点击任一行业进入独立的“行业穿透”页（可直接分享链接）：
  - 顶部行业胶囊按 |主动权重| 排序，一键切换行业
  - 概览卡：行业组合 / 基准 / 主动权重、组合持有 / 基准成分只数、**超配（低配）主要来源**
  - 明细表列出该行业组合 ∪ 基准的全部个股，标出“共同持有 / 仅组合 / 仅基准”，并给出**贡献占比 = 个股主动权重 ÷ 行业主动权重**（合计 100%）和贡献条；未持有的基准成分较多时合并成可展开的一行

**② 多组合并排对比（同一基准）**

- 勾选 2~6 个组合，选定统一基准：
  - **偏离 × 集中定位图**：横轴主动份额、纵轴 HHI，四象限一眼看出谁“高偏离 · 高集中”
  - 选中组合的摘要（主动份额、重合权重、HHI 与等效持股数、前十大、最大超配 / 低配行业），可一键打开该组合体检
  - 指标对比表、行业主动权重对照表；可导出 CSV
- 后端对应 `POST /api/comparisons`（多组合横向对比）。每个组合的分析也各自留痕。

### 为什么

- **超低配 + 穿透**：行业偏离只是结论，投研和风控下一个问题一定是“谁造成的”。比如“低配 3.9% 是因为没买哪几只权重股，还是买的都偏小”，这决定是主动判断还是疏漏。把“发现偏离 → 定位个股”压缩成一次点击，是每天都会用到的高频路径；发散图用位置和方向表达正负，比两根柱子相减更直观。
- **并排对比**：同一口径下的横向比较本来就是这个工具的出发点（需求背景）。风控要横评多只产品，投研要比较调仓前后（可以先上传调仓后的模拟持仓）。并排看 HHI、主动份额、行业押注和共同重仓，可以马上判断两个组合是“风格相似”还是“偏离方向相反”。
- 配色上：默认按 A 股习惯“红超配 / 绿低配”；顶栏可切换为色弱友好的“橙超配 / 蓝低配”，所有页面同步生效并记住选择。方向始终同时用 ▲/▼ 和 +/− 表示，不只靠颜色。

### 其他细节

- 每次分析（含失败的）都有留痕号和输入指纹（SHA-256），“分析记录”页可按状态筛选、回看结果或失败原因、一键加入对比，方便复核和审计。
- 界面按 `ui-spec/UI_SPEC.md` 实现，有几处取舍：只做浅色主题；规格中的“生成体检报告”暂未实现；数据中没有“持仓日期”，不显示；额外提供“持仓明细”表，列出每只股票的组合权重。
- 行业分布、个股主动权重可以一键导出 CSV，Excel 直接打开不乱码。

---

## License

[MIT](LICENSE)
