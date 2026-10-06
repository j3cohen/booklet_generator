import { describe, expect, it } from 'vitest'
import { impose, summarize, toOutputSides } from './imposition'

describe('impose', () => {
  it('orders an 8-page single booklet', () => {
    const [sig] = impose(8)
    expect(sig.sheets).toEqual([
      { front: [8, 1], back: [2, 7] },
      { front: [6, 3], back: [4, 5] },
    ])
  })

  it('pads a 5-page document with 3 blanks at the end', () => {
    const sigs = impose(5)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].sheets).toEqual([
      { front: [null, 1], back: [2, null] },
      { front: [null, 3], back: [4, 5] },
    ])
    expect(summarize(sigs, 5)).toEqual({ signatures: 1, sheets: 2, outputPages: 4, blankPages: 3 })
  })

  it('handles a single page', () => {
    expect(impose(1)[0].sheets).toEqual([{ front: [null, 1], back: [null, null] }])
  })

  it('splits 20 pages into 2-sheet signatures of 8/8/4', () => {
    const sigs = impose(20, 2)
    expect(sigs.map((s) => s.sheets.length)).toEqual([2, 2, 1])
    expect(sigs.map((s) => s.firstPage)).toEqual([1, 9, 17])
    expect(sigs[1].sheets).toEqual([
      { front: [16, 9], back: [10, 15] },
      { front: [14, 11], back: [12, 13] },
    ])
    expect(sigs[2].sheets).toEqual([{ front: [20, 17], back: [18, 19] }])
    expect(summarize(sigs, 20).blankPages).toBe(0)
  })

  it('rejects bad input', () => {
    expect(() => impose(0)).toThrow()
    expect(() => impose(3.5)).toThrow()
    expect(() => impose(4, -1)).toThrow()
  })
})

describe('toOutputSides', () => {
  it('marks odd output pages as rotated in back mode', () => {
    const sides = toOutputSides(impose(8), 'back')
    expect(sides.map((s) => s.rotated)).toEqual([false, true, false, true])
    expect(sides.map((s) => s.slots)).toEqual([[8, 1], [2, 7], [6, 3], [4, 5]])
  })

  it('marks even output pages as rotated in front mode', () => {
    expect(toOutputSides(impose(4), 'front').map((s) => s.rotated)).toEqual([true, false])
  })

  it('rotates nothing in none mode', () => {
    expect(toOutputSides(impose(4), 'none').every((s) => !s.rotated)).toBe(true)
  })
})
