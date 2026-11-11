import type { ReactNode } from 'react'
import { SCHEME_LABEL, useDirection } from '../direction'
import type { DirectionScheme } from '../direction'

export type NavKey = 'analysis' | 'industry' | 'compare' | 'runsNew' | 'runs'

/** 侧栏图标（描边风格，装饰性） */
const ICON_PATHS: Record<NavKey, string> = {
  analysis: 'M3 13h3l2-6 3 10 2-4h4',                       // 体检：脉搏线
  industry: 'M4 4h12v4H4z M6 8v8 M14 8v8 M4 16h12',          // 穿透：层级
  compare: 'M5 16V9 M10 16V4 M15 16v-5',                     // 对比：柱状
  runs: 'M5 4h10v13H5z M8 8h4 M8 11h4 M8 14h2',              // 记录：清单
  runsNew: 'M10 3l6 3v4c0 4-3 6-6 7-3-1-6-3-6-7V6z M7.5 10l2 2 3.5-4', // 校验：盾牌
}
function NavIcon({ name }: { name: NavKey }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d={ICON_PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AppShell({ active, industryHref, children }: {
  active: NavKey | null
  industryHref: string
  children: ReactNode
}) {
  const { scheme, setScheme } = useDirection()
  const item = (key: NavKey, label: string, to: string) => (
    <a href={to} aria-current={active === key ? 'page' : undefined}><NavIcon name={key} />{label}</a>
  )
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="1" width="20" height="20" rx="3" fill="none" stroke="var(--brand-gold)" strokeWidth="2" />
            <path d="M5 15 L9 10 L12 13 L17 6" fill="none" stroke="var(--text-on-brand)" strokeWidth="2" />
          </svg>
          <b>投研风控平台</b>
          <span className="sep">/</span>
          <span className="sub">组合持仓分析</span>
        </div>
        <div className="right">
          <span className="env-tag">内部工具</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            方向色
            <select value={scheme} onChange={(e) => setScheme(e.target.value as DirectionScheme)} aria-label="超配低配方向色方案">
              {(Object.keys(SCHEME_LABEL) as DirectionScheme[]).map((k) => <option key={k} value={k}>{SCHEME_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
      </header>
      <div className="shell">
        <nav className="sidenav" aria-label="主导航">
          <div className="group">分析</div>
          {item('analysis', '组合体检', '#/analysis')}
          {item('industry', '行业穿透', industryHref)}
          {item('compare', '多组合对比', '#/compare')}
          <div className="group">管理</div>
          {item('runs', '分析记录', '#/runs')}
          {item('runsNew', '数据与校验', '#/runs/new')}
        </nav>
        <main className="main">{children}</main>
      </div>
    </>
  )
}
