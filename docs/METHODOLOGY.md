# 计算口径与校验规则

本文件是分析引擎（`backend/app/engine/analyzer.py`）的口径说明。所有权重都用小数表示（0.05 即 5%）。

## 1. 输入

| 数据 | 字段 | 说明 |
|---|---|---|
| 主数据 `stock_info.csv` | `stock_code, stock_name, industry` | 每只股票所属行业；代码全局唯一 |
| 组合 `portfolios/*.csv` | `stock_code, market_value` | 持仓市值，必须为正数 |
| 基准 `benchmarks/*.csv` | `stock_code, weight` | 成分股权重，非负，合计应为 1 |

股票代码一律按字符串处理（保留前导 0）。CSV 支持 UTF-8（含 BOM）与 GBK。

## 2. 指标定义

记组合权重为 `wp`，基准权重为 `wb`。

- **组合权重**：`wp(i) = 市值(i) / Σ 市值`。
- **并集**：所有指标都在“组合 ∪ 基准”上计算。只出现在一边的股票，另一边的权重记为 0。
- **行业权重**：按主数据中的行业字段对 `wp`、`wb` 分别求和；行业主动权重 = 组合行业权重 − 基准行业权重。行业清单完全由数据决定。
- **个股主动权重**：`wp − wb`。只在基准中、组合未持有的股票，主动权重为负。
- **前十大权重**：按 `wp` 降序、代码升序排序后取前 10 只求和；持仓不足 10 只时取全部。
- **HHI**：`Σ wp²`。单只持仓时 HHI = 1；`1 / HHI` 可理解为“等效持股数”。
- **主动份额**：`0.5 × Σ |wp − wb|`。与基准完全相同时为 0，完全不重合时为 1。
- **重合股票数**：`wp > 0` 且 `wb > 0` 的股票数。
- **重合权重**：`Σ min(wp, wb)`。当基准权重合计恰为 1 时，重合权重 + 主动份额 = 1（输出 `overlap_plus_active_share` 供自检）。

## 3. 排序

- 个股列表：主动权重降序，并列时代码升序。
- 超配 Top N：主动权重 > 0，降序；低配 Top N：主动权重 < 0，升序（低配最多的在前）。并列时代码升序。
- 排序与方向判断都基于**舍入前**的精确值，舍入为 0 的持仓仍视为“持有”。

## 4. 精度

中间计算全程不舍入（求和使用 `math.fsum`）；仅在输出时用 `Decimal` 以 ROUND_HALF_UP 保留 6 位小数。

## 5. 校验规则

| 规则 | 错误码 |
|---|---|
| 持仓市值 ≤ 0 | `NON_POSITIVE_MARKET_VALUE` |
| 同一文件内股票代码重复 | `DUPLICATE_STOCK_CODE` |
| 股票不在主数据中 | `UNKNOWN_STOCK` |
| 基准权重为负 | `NEGATIVE_BENCHMARK_WEIGHT` |
| 基准权重合计偏离 1 超过 ±0.01 | `BENCHMARK_WEIGHT_SUM_INVALID` |
| 缺少必需字段 | `FIELD_MISSING` |
| 数值缺失 / 无法解析 / NaN / Inf | `VALUE_UNPARSEABLE` |
| 空文件、编码无法识别、数据行列数多于表头等 | `INVALID_FILE` |
| 组合没有持仓 | `EMPTY_PORTFOLIO` |

基准合计在 ±0.01 容差内时**按原值计算、不归一化**，结果附带 `warnings` 与 `benchmark_weight_sum`。

主数据不可用时服务拒绝启动；某个预置组合 / 基准不合规时，只将该数据源标记为 `invalid`，不影响其他数据源。

## 6. 参考答案与测试

`backend/scripts/gen_sample.py` 生成默认示例数据，并用 `gen_boundary_cases.py` 中基于 `fractions.Fraction` 的独立参考实现计算 `backend/tests/fixtures/expected_*`。引擎（浮点实现）的输出与参考答案的误差需 < 1e-6。
