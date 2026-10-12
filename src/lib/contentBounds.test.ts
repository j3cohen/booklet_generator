import { describe, expect, it } from 'vitest'
import { pixelBounds } from './contentBounds'

function whiteImage(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4)
  data.fill(255)
  return data
}

function paint(data: Uint8ClampedArray, w: number, x: number, y: number, value = 0) {
  const i = (y * w + x) * 4
  data[i] = data[i + 1] = data[i + 2] = value
}

describe('pixelBounds', () => {
  it('returns null for a blank image', () => {
    expect(pixelBounds(whiteImage(10, 10), 10, 10)).toBeNull()
  })

  it('finds the box around a dark block', () => {
    const w = 20, h = 30
    const data = whiteImage(w, h)
    for (let y = 5; y <= 12; y++) for (let x = 3; x <= 9; x++) paint(data, w, x, y)
    expect(pixelBounds(data, w, h)).toEqual({ minX: 3, minY: 5, maxX: 9, maxY: 12 })
  })

  it('ignores isolated specks', () => {
    const w = 20, h = 30
    const data = whiteImage(w, h)
    for (let y = 5; y <= 12; y++) for (let x = 3; x <= 9; x++) paint(data, w, x, y)
    paint(data, w, 19, 29) // single dark pixel in the far corner
    expect(pixelBounds(data, w, h)).toEqual({ minX: 3, minY: 5, maxX: 9, maxY: 12 })
  })

  it('treats light grey as white but mid grey as ink', () => {
    const w = 4, h = 4
    const data = whiteImage(w, h)
    paint(data, w, 1, 1, 245)
    paint(data, w, 2, 1, 245)
    expect(pixelBounds(data, w, h)).toBeNull()
    paint(data, w, 1, 1, 128)
    paint(data, w, 2, 1, 128)
    paint(data, w, 1, 2, 128)
    paint(data, w, 2, 2, 128)
    expect(pixelBounds(data, w, h)).toEqual({ minX: 1, minY: 1, maxX: 2, maxY: 2 })
  })
})
