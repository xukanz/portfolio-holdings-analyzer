import type { SourceSummary } from '../types'

/** 组合 / 基准下拉。allowInvalid 时不合规的数据源也可选（用于“仅校验”查看具体问题） */
export function SourceSelect({ label, items, value, onChange, allowInvalid = false, stacked = false, id }: {
  label: string
  items: SourceSummary[]
  value: string
  onChange: (id: string) => void
  allowInvalid?: boolean
  stacked?: boolean
  id?: string
}) {
  return (
    <label className={stacked ? 'stack-field' : 'inline-field'} htmlFor={id}>
      {label}
      <select id={id} className="select" style={stacked ? undefined : { minWidth: 220 }} value={value} onChange={(e) => onChange(e.target.value)}>
        {items.length === 0 && <option value="">（无）</option>}
        {!value && items.length > 0 && <option value="">请选择</option>}
        {items.map((s) => (
          <option key={s.id} value={s.id} disabled={!allowInvalid && s.status !== 'ok'}>
            {s.name}
            {s.source === 'upload' ? '（上传）' : ''}
            {s.status !== 'ok' ? '（数据不合规）' : ` · ${s.row_count} 只`}
          </option>
        ))}
      </select>
    </label>
  )
}
