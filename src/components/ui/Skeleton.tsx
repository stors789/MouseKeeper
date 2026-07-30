import { clsx } from 'clsx'
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  width?: CSSProperties['width']
  height?: CSSProperties['height']
}

export function Skeleton({
  className,
  height,
  style,
  width,
  ...props
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx('ui-skeleton', className)}
      style={{ ...style, height, width }}
      {...props}
    />
  )
}

interface SkeletonGroupProps {
  label?: string
  children: ReactNode
  className?: string
}

export function SkeletonGroup({
  children,
  className,
  label = '正在加载'
}: SkeletonGroupProps) {
  return (
    <div className={className} role="status" aria-label={label}>
      {children}
      <span className="sr-only">{label}</span>
    </div>
  )
}
