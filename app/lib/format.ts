import type { LastAction } from '#shared/protocol'

/** 筹码缩写：561K / 1.28M，与设计稿一致 */
export function fmtChips(n: number): string {
  const abs = Math.abs(n)
  const trim = (v: number) => v.toFixed(2).replace(/\.?0+$/, '')
  if (abs >= 1e6)
    return `${trim(n / 1e6)}M`
  if (abs >= 1000)
    return `${Math.round(abs / 1000) === abs / 1000 ? Math.round(n / 1000) : trim(n / 1000)}K`
  return String(Math.round(n))
}

export function actionLabel(a: LastAction | null): string {
  if (!a) return ''
  switch (a.k) {
    case 'fold': return '弃牌'
    case 'check': return '过牌'
    case 'call': return `跟注 ${fmtChips(a.amount)}`
    case 'bet': return `下注 ${fmtChips(a.amount)}`
    case 'raise': return `加注到 ${fmtChips(a.amount)}`
    case 'all-in': return `全下 ${fmtChips(a.amount)}`
    case 'sb': return `小盲 ${fmtChips(a.amount)}`
    case 'bb': return `大盲 ${fmtChips(a.amount)}`
  }
}

export const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦉', '🐧', '🐺', '🦄', '🐙']

export interface Profile {
  name: string
  avatar: string
}

const PROFILE_KEY = 'holdem:profile'

export function loadProfile(): Profile | null {
  if (!import.meta.client) return null
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p.name === 'string' && p.name) return { name: p.name, avatar: p.avatar ?? '🦊' }
  }
  catch {}
  return null
}

export function saveProfile(p: Profile) {
  if (!import.meta.client) return
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface Identity {
  playerId: string
  token: string
}

const identityKey = (code: string) => `holdem:identity:${code}`

export function loadIdentity(code: string): Identity | null {
  if (!import.meta.client) return null
  try {
    const raw = localStorage.getItem(identityKey(code))
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p.playerId === 'string' && typeof p.token === 'string') return p
  }
  catch {}
  return null
}

export function saveIdentity(code: string, id: Identity) {
  if (!import.meta.client) return
  localStorage.setItem(identityKey(code), JSON.stringify(id))
}

export function clearIdentity(code: string) {
  if (!import.meta.client) return
  localStorage.removeItem(identityKey(code))
}
