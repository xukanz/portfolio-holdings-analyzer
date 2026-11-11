import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type DirectionScheme = 'aShare' | 'colorblindSafe'
const KEY = 'pa.directionScheme'

function load(): DirectionScheme {
  try {
    return window.localStorage.getItem(KEY) === 'colorblindSafe' ? 'colorblindSafe' : 'aShare'
  } catch {
    return 'aShare'
  }
}

const Ctx = createContext<{ scheme: DirectionScheme; setScheme: (s: DirectionScheme) => void }>({
  scheme: 'aShare', setScheme: () => {},
})

/** 方向色方案：写到 <html data-direction>，CSS 变量 --up/--down 随之切换，所有页面同步生效 */
export function DirectionProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<DirectionScheme>(load)
  useEffect(() => {
    document.documentElement.dataset.direction = scheme
    try {
      window.localStorage.setItem(KEY, scheme)
    } catch {
      // 无痕模式等场景下存储不可用，忽略
    }
  }, [scheme])
  return <Ctx.Provider value={{ scheme, setScheme }}>{children}</Ctx.Provider>
}

export const useDirection = () => useContext(Ctx)

export const SCHEME_LABEL: Record<DirectionScheme, string> = {
  aShare: 'A股惯例（红超配 / 绿低配）',
  colorblindSafe: '色弱友好（橙超配 / 蓝低配）',
}
