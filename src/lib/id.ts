let n = 0
export const uid = (prefix = 'o') => `${prefix}_${(n++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`
