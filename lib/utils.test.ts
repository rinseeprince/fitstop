import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn (classname utility)', () => {
  it('merges simple class names', () => {
    const result = cn('class1', 'class2')
    expect(result).toBe('class1 class2')
  })

  it('handles conditional classes', () => {
    const result = cn('base', true && 'included', false && 'excluded')
    expect(result).toBe('base included')
  })

  it('handles undefined and null values', () => {
    const result = cn('base', undefined, null, 'end')
    expect(result).toBe('base end')
  })

  it('merges Tailwind classes correctly (last wins)', () => {
    const result = cn('p-2', 'p-4')
    expect(result).toBe('p-4')
  })

  it('handles conflicting Tailwind utilities', () => {
    const result = cn('text-red-500', 'text-blue-500')
    expect(result).toBe('text-blue-500')
  })

  it('preserves non-conflicting classes', () => {
    const result = cn('p-2', 'm-4', 'text-lg')
    expect(result).toBe('p-2 m-4 text-lg')
  })

  it('handles array of classes', () => {
    const result = cn(['class1', 'class2'])
    expect(result).toBe('class1 class2')
  })

  it('handles object syntax', () => {
    const result = cn({
      'base-class': true,
      'conditional-class': true,
      'excluded-class': false,
    })
    expect(result).toBe('base-class conditional-class')
  })

  it('handles mixed input types', () => {
    const isActive = true
    const result = cn(
      'base',
      ['array-class'],
      { 'object-class': true },
      isActive && 'active'
    )
    expect(result).toBe('base array-class object-class active')
  })

  it('handles empty inputs', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
    expect(cn('', '', '')).toBe('')
  })

  it('trims whitespace', () => {
    const result = cn('  class1  ', '  class2  ')
    expect(result).not.toContain('  ')
  })

  it('handles responsive Tailwind classes', () => {
    const result = cn('text-sm', 'md:text-base', 'lg:text-lg')
    expect(result).toBe('text-sm md:text-base lg:text-lg')
  })

  it('merges conflicting responsive classes correctly', () => {
    const result = cn('md:p-2', 'md:p-4')
    expect(result).toBe('md:p-4')
  })

  it('handles hover/focus states', () => {
    const result = cn('bg-blue-500', 'hover:bg-blue-600', 'focus:ring-2')
    expect(result).toBe('bg-blue-500 hover:bg-blue-600 focus:ring-2')
  })

  it('handles dark mode classes', () => {
    const result = cn('bg-white', 'dark:bg-gray-900')
    expect(result).toBe('bg-white dark:bg-gray-900')
  })

  it('handles complex real-world example', () => {
    const isDisabled = true
    const variant = 'primary'

    const result = cn(
      'inline-flex items-center justify-center rounded-md text-sm font-medium',
      'transition-colors focus-visible:outline-none focus-visible:ring-2',
      variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
      variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      isDisabled && 'pointer-events-none opacity-50'
    )

    expect(result).toContain('bg-primary')
    expect(result).toContain('pointer-events-none')
    expect(result).toContain('opacity-50')
    expect(result).not.toContain('bg-secondary')
  })
})
