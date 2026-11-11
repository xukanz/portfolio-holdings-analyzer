/** 仅用于展示的格式化；格式化结果不得再参与计算 */
const MINUS = '−'

export const fmtPct = (v: number, digits = 2) => `${(v * 100).toFixed(digits).replace('-', MINUS)}%`

export const fmtSignedPct = (v: number, digits = 2) => {
  const s = (Math.abs(v) * 100).toFixed(digits)
  return v > 0 ? `+${s}%` : v < 0 ? `${MINUS}${s}%` : `${s}%`
}

/** 方向：优先使用后端按原始精度给出的 active_side，避免把舍入为 0 的值误判为中性 */
export type Side = 'over' | 'under' | 'neutral'
export const sideOf = (v: number, side?: Side | null): Side => side ?? (v > 0 ? 'over' : v < 0 ? 'under' : 'neutral')

export const fmtActive = (v: number, side?: Side | null, digits = 2) => {
  const s = sideOf(v, side)
  if (s === 'neutral') return fmtPct(0, digits)
  const abs = (Math.abs(v) * 100).toFixed(digits)
  return s === 'over' ? `▲ +${abs}%` : `▼ ${MINUS}${abs}%`
}

export const fmtHhi = (v: number) => v.toFixed(6)
export const fmtRaw = (v: number) => v.toFixed(6)
export const fmtInt = (n: number) => n.toLocaleString('zh-CN')

export const fmtMoney = (x: number) => {
  if (x >= 1e8) return `${(x / 1e8).toFixed(2)} 亿元`
  if (x >= 1e4) return `${(x / 1e4).toFixed(2)} 万元`
  return `${fmtInt(x)} 元`
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })

/** SHA-256 指纹缩写：前4…后4 */
export const fmtHash = (h: string) => (h ? `${h.slice(0, 4)}…${h.slice(-4)}` : '—')

export const shortId = (id: string) => id.slice(0, 8)

/** 比例尺：向上取整到 step 的倍数（纯展示用） */
export const ceilTo = (v: number, step: number) => Math.max(step, Math.ceil(v / step - 1e-9) * step)
