/**
 * 投资组合持仓分析工具 · 前端数据契约
 * 与 UI_SPEC.md 第 4 节的 API 映射配套使用。
 * 约定：所有 *Weight / activeShare / hhi 字段均为 0~1 小数，后端已按 6 位小数四舍五入。
 * 前端只做展示格式化，不做业务计算。
 */

/** 后端统一错误结构（任何 4xx/5xx 都返回此结构，绝不含堆栈） */
export interface ApiError {
  code: string;                 // 如 "INPUT_VALIDATION_FAILED"
  message: string;              // 可直接展示给用户的中文说明
  details?: ValidationIssue[];
  requestId?: string;
}

export type ValidationRule =
  | 'MARKET_VALUE_NON_POSITIVE'
  | 'DUPLICATE_STOCK_CODE'
  | 'STOCK_NOT_IN_MASTER'
  | 'BENCHMARK_WEIGHT_SUM_OUT_OF_RANGE'
  | 'FIELD_MISSING'
  | 'VALUE_UNPARSEABLE'
  | 'FILE_NOT_FOUND';

export interface ValidationIssue {
  rule: ValidationRule | string; // 未知 rule 时前端回退显示 message
  message?: string;
  file?: string;                 // "portfolio.csv"
  line?: number;
  lines?: number[];              // 代码重复时的多行
  stockCode?: string;
  value?: string;
  actual?: number;               // 基准权重合计
  tolerance?: number;
}

/** 持有状态，用于标签 */
export type HoldingStatus = 'both' | 'portfolioOnly' | 'benchmarkOnly';

export interface IndustryRow {
  industry: string;
  portfolioWeight: number;
  benchmarkWeight: number;
  activeWeight: number;          // portfolio − benchmark
  portfolioStockCount?: number;
  benchmarkStockCount?: number;
}

export interface StockActiveRow {
  stockCode: string;
  stockName: string;
  industry: string;
  portfolioWeight: number;       // 仅基准时为 0
  benchmarkWeight: number;       // 仅组合时为 0
  activeWeight: number;
  status: HoldingStatus;
}

export interface ConcentrationMetrics {
  top10Weight: number;
  hhi: number;
  maxStock: { stockCode: string; stockName: string; weight: number };
}

export interface DeviationMetrics {
  activeShare: number;
  overlapCount: number;
  overlapWeight: number;
  /** overlapWeight + activeShare，用于自检显示 */
  selfCheckSum: number;
}

export interface AnalysisResult {
  runId: string;                 // "RUN-20261017-0042"
  createdAt: string;             // ISO 8601
  portfolio: { id: string; name: string; file: string; stockCount: number };
  benchmark: { id: string; name: string; file: string; stockCount: number };
  holdingDate?: string;
  unionCount: number;
  concentration: ConcentrationMetrics;
  deviation: DeviationMetrics;
  industries: IndustryRow[];
  topOverweight: StockActiveRow[];
  topUnderweight: StockActiveRow[];
  elapsedMs: number;
}

export interface ComparisonRow {
  portfolioId: string;
  portfolioName: string;
  top10Weight: number;
  hhi: number;
  activeShare: number;
  overlapCount: number;
  overlapWeight: number;
  maxOverweightIndustry: { industry: string; activeWeight: number } | null;
  maxUnderweightIndustry: { industry: string; activeWeight: number } | null;
  runId: string;
}

export type RunStatus = 'success' | 'failed';

export interface RunRecord {
  runId: string;
  createdAt: string;
  portfolioName: string;
  benchmarkName: string;
  /** 输入文件内容的 SHA-256，用于留痕与复现 */
  inputHashes: { portfolio: string; benchmark: string; stockInfo: string } | null;
  activeShare: number | null;
  elapsedMs: number | null;
  status: RunStatus;
  httpStatus?: number;
  errorSummary?: string;         // "4 处校验错误"
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface HealthInfo {
  ok: boolean;
  stockCount: number;
  industryCount: number;
  issues: ValidationIssue[];     // 启动自检问题，为空表示正常
}

/** 方向色方案，对应 design-tokens.json color.direction */
export type DirectionScheme = 'aShare' | 'colorblindSafe';
