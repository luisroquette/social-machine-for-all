import { describe, it, expect } from 'vitest'
import { VARIABLE_DEFINITIONS, CATEGORY_LABELS } from '../src/lib/settings/load-settings'

describe('VARIABLE_DEFINITIONS', () => {
  it('has no duplicate keys', () => {
    const keys = VARIABLE_DEFINITIONS.map(d => d.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('every variable has required fields', () => {
    for (const def of VARIABLE_DEFINITIONS) {
      expect(def.key).toBeTruthy()
      expect(def.category).toBeTruthy()
      expect(def.label).toBeTruthy()
      expect(def.description).toBeTruthy()
      expect(['number', 'string', 'boolean']).toContain(def.type)
      expect(def.defaultValue).toBeDefined()
    }
  })

  it('numeric variables have valid default values', () => {
    const numericDefs = VARIABLE_DEFINITIONS.filter(d => d.type === 'number')
    for (const def of numericDefs) {
      const parsed = parseFloat(def.defaultValue)
      expect(parsed).not.toBeNaN()
    }
  })

  it('every category has a label in CATEGORY_LABELS', () => {
    const categories = new Set(VARIABLE_DEFINITIONS.map(d => d.category))
    for (const cat of categories) {
      expect(CATEGORY_LABELS[cat]).toBeDefined()
      expect(CATEGORY_LABELS[cat].label).toBeTruthy()
    }
  })

  it('has at least 50 variables', () => {
    expect(VARIABLE_DEFINITIONS.length).toBeGreaterThanOrEqual(50)
  })

  it('covers all 8 categories', () => {
    const categories = new Set(VARIABLE_DEFINITIONS.map(d => d.category))
    expect(categories.size).toBe(8)
    expect(categories).toContain('branding')
    expect(categories).toContain('ai_models')
    expect(categories).toContain('pipeline')
    expect(categories).toContain('trend_video')
    expect(categories).toContain('rate_limits')
    expect(categories).toContain('timeouts')
    expect(categories).toContain('quality')
    expect(categories).toContain('quiet_hours')
  })
})
