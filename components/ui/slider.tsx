'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/clients/training/program-builder/builder-tokens'

// Teal-Summit slider. Was un-migrated shadcn: an OKLCH `bg-muted` track, a
// `bg-primary` range and a `ring-ring` focus treatment in place of the shared
// ring. The track is the h-1.5 rounded bar the macro split bars already use;
// the thumb is a 16px white circle on a teal hairline.
type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  /**
   * One accessible name per thumb, in value order. Radix's own fallback names
   * a two-thumb pair "Minimum" / "Maximum", which is wrong when the thumbs are
   * boundaries rather than the ends of a range (the macro balancer).
   */
  thumbLabels?: readonly string[]
  /**
   * Content rendered inside the track IN PLACE OF the range fill — for a
   * track that is itself the information, such as the macro balancer's three
   * colour bands. Sized by the caller; the track clips it to its own bar.
   */
  trackContent?: React.ReactNode
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  thumbLabels,
  trackContent,
  ...props
}: SliderProps) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={
          'relative grow overflow-hidden rounded-full bg-[rgba(13,148,136,0.08)] data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5'
        }
      >
        {trackContent ?? (
          <SliderPrimitive.Range
            data-slot="slider-range"
            className={
              'absolute bg-[#0d9488] data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full'
            }
          />
        )}
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={thumbLabels?.[index]}
          className={cn(
            'block size-4 shrink-0 rounded-full border border-[#0d9488] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-colors hover:border-[#0b7f75] disabled:pointer-events-none disabled:opacity-50',
            FOCUS_RING,
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
