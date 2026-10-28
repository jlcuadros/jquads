import { describe, expect, it } from 'vitest'
import { autoDepth, autoThreatDepth } from './autoDepth'

describe('autoDepth (José\'s reference points, 2026-10-28)', () => {
  it('hits both points: iPhone 15 1.83 M nodes/s → 15, 0.4 M → 10', () => {
    expect(autoDepth(1.83e6)).toBe(15)
    expect(autoDepth(0.4e6)).toBe(10)
  })
  it('in between and faster: grows with the logarithm of the speed', () => {
    expect(autoDepth(1.46e6)).toBe(14) // the Mac emulator
    expect(autoDepth(0.8e6)).toBe(12)
    expect(autoDepth(3.6e6)).toBe(17)
  })
  it('never below 10, never above 24; 14 without a measurement', () => {
    expect(autoDepth(0.05e6)).toBe(10)
    expect(autoDepth(1e9)).toBe(24)
    expect(autoDepth(undefined)).toBe(14)
  })
  it('threats: 3 less, never below 9', () => {
    expect(autoThreatDepth(15)).toBe(12)
    expect(autoThreatDepth(10)).toBe(9)
    expect(autoThreatDepth(11)).toBe(9)
  })
})
