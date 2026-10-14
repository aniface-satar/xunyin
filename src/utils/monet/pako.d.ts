declare module 'pako' {
  export function deflate(data: Uint8Array, options?: { level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }): Uint8Array
}
