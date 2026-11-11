import { ApiError } from '../api'
import type { ValidationOk } from '../types'
import { describeDetail } from './ErrorAlert'
import { Panel } from './ui'

/** 规则 → 业务文案（前端维护）；未知规则直接显示后端 message */
const RULES: Record<string, { title: string; fix: string }> = {
  NON_POSITIVE_MARKET_VALUE: { title: '持仓市值必须为正数', fix: '剔除该行或修正市值后重新上传' },
  DUPLICATE_STOCK_CODE: { title: '股票代码重复', fix: '合并为一行（市值相加）或删除重复项' },
  UNKNOWN_STOCK: { title: '股票不在主数据中', fix: '补充 stock_info.csv 中的名称与行业' },
  BENCHMARK_WEIGHT_SUM_INVALID: { title: '基准权重合计偏离 1', fix: '核对基准成分是否缺失，合计需在 1 ± 0.01 之内' },
  NEGATIVE_BENCHMARK_WEIGHT: { title: '基准权重不能为负', fix: '修正该成分股的权重' },
  FIELD_MISSING: { title: '数据文件缺少必需字段', fix: '检查表头是否完整（组合：stock_code, market_value；基准：stock_code, weight）' },
  VALUE_UNPARSEABLE: { title: '数值缺失或无法解析', fix: '检查该单元格格式，只填写数字' },
  FILE_NOT_FOUND: { title: '数据文件缺失', fix: '确认文件已放入数据目录' },
  EMPTY_PORTFOLIO: { title: '组合没有任何持仓', fix: '至少提供一行持仓' },
  INVALID_FILE: { title: '数据文件格式错误', fix: '检查文件编码（UTF-8 / GBK）与 CSV 格式' },
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large', 422: 'Unprocessable Entity', 500: 'Internal Server Error',
}

export type ValidationState =
  | { kind: 'idle'; note?: string }
  | { kind: 'pass'; info: ValidationOk }
  | { kind: 'fail'; error: unknown; context?: string }

type Issue = Record<string, unknown> & { rule: string; message: string }

function toIssues(e: ApiError): Issue[] {
  if (e.code === 'VALIDATION_FAILED') return e.details.map((d) => ({ rule: 'UNKNOWN', message: e.message, ...d }) as Issue)
  // 上传等接口直接返回具体错误码：每条明细都归到该错误码下
  return e.details.length
    ? e.details.map((d) => ({ ...d, rule: e.code, message: e.message }))
    : [{ rule: e.code, message: e.message }]
}

function location(i: Issue): string {
  const src = i.source === 'portfolio' ? '组合' : i.source === 'benchmark' ? '基准' : ''
  const file = i.file ? `${src}「${String(i.file)}」` : src
  const rest = describeDetail(Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'file')))
  return [file, rest].filter(Boolean).join(' · ')
}

const Icon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="8" fill="none" stroke="var(--error)" strokeWidth="1.6" />
    <path d="M9 4.5 V10" stroke="var(--error)" strokeWidth="1.8" />
    <circle cx="9" cy="13" r="1.1" fill="var(--error)" />
  </svg>
)

export function ValidationPanel({ state }: { state: ValidationState }) {
  let badge = <span className="badge idle">待校验</span>
  let body = <div className="state">{state.kind === 'idle' && state.note ? state.note : '选择数据后点击“仅校验”或“开始分析”'}</div>

  if (state.kind === 'pass') {
    badge = <span className="badge ok">校验通过</span>
    body = (
      <div className="state" style={{ color: 'var(--success)' }}>
        ✓ 组合「{state.info.portfolio.name}」{state.info.portfolio.rows} 只、基准「{state.info.benchmark.name}」{state.info.benchmark.rows} 只：
        字段完整、数值可解析、代码无重复、股票均在主数据中、基准权重合计合规
      </div>
    )
  } else if (state.kind === 'fail') {
    const e = state.error instanceof ApiError ? state.error : new ApiError({ code: 'CLIENT_ERROR', message: String(state.error), details: [] })
    if (e.isUnavailable) {
      badge = <span className="badge bad">校验未完成</span>
      body = <div className="state" role="alert">服务暂时不可用，请稍后重试</div>
    } else {
      const issues = toIssues(e)
      badge = <span className="badge bad">未通过 · {issues.length} 处问题 · 已拒绝分析</span>
      body = (
        <>
          {state.context && <div className="panel-foot" style={{ borderTop: 0, borderBottom: '1px solid var(--border-row)' }}>{state.context}</div>}
          <div role="alert">
            {issues.slice(0, 50).map((i, k) => {
              const rule = RULES[i.rule]
              return (
                <div className="issue" key={k}>
                  <Icon />
                  <div>
                    <div className="t">{rule?.title ?? i.message}</div>
                    <div className="w">{location(i)}</div>
                    {rule && <div className="f">处理建议：{rule.fix}</div>}
                  </div>
                </div>
              )
            })}
            {issues.length > 50 && <div className="issue muted">…… 另有 {issues.length - 50} 处</div>}
          </div>
          <details className="raw">
            <summary>查看接口返回（统一错误格式，开发排查用）</summary>
            <pre>{`HTTP/1.1 ${e.status || ''} ${STATUS_TEXT[e.status] ?? ''}\n${JSON.stringify({ error: e.body }, null, 2)}`}</pre>
          </details>
        </>
      )
    }
  }

  return (
    <Panel label="校验结果" title="校验结果" extra={badge}>
      {body}
    </Panel>
  )
}
