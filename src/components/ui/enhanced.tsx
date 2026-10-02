'use client';

import { cn } from '@/lib/utils';
import { forwardRef, type LinkHTMLAttributes } from 'react';

type StyledLinkProps = LinkHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'default' | 'subtle' | 'violet' | 'danger' | 'ghost';
};

/**
 * Styled link with consistent hover/focus states.
 * Uses CSS variables so it works in any context.
 */
export const StyledLink = forwardRef<HTMLAnchorElement, StyledLinkProps>(
  ({ className, children, variant = 'default', ...props }, ref) => {
    const base =
      'inline-flex items-center gap-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-2 focus-visible:ring-offset-void';

    const variants: Record<string, string> = {
      default: 'text-neon hover:text-neon-dim',
      subtle: 'text-ink-dim hover:text-ink',
      violet: 'text-violet hover:text-violet/80',
      danger: 'text-rose hover:text-rose/80',
      ghost: 'text-ink-faint hover:text-ink',
    };

    return (
      <a ref={ref} className={cn(base, variants[variant], className)} {...props}>
        {children}
      </a>
    );
  },
);

StyledLink.displayName = 'StyledLink';

/**
 * Animated gradient border - for highlighting important panels
 */
export function GlowBorder({
  children,
  className,
  active = true,
}: {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative rounded-[var(--radius-panel)] overflow-hidden',
        active && 'animate-glow-pulse',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Tooltip - simple, accessible, CSS-only
 */
export function Tooltip({
  children,
  content,
  position = 'top',
}: {
  children: React.ReactElement;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const positionStyles = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowStyles = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-neon',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-neon',
    left: 'right-full top-1/2 -translate-y-1/2 border-l-neon',
    right: 'left-full top-1/2 -translate-y-1/2 border-r-neon',
  };

  return (
    <div className="relative inline-flex" tabIndex={0}>
      {children}
      <div
        className={cn(
          'absolute z-50 px-2.5 py-1.5 text-[0.625rem] font-medium text-abyss bg-neon rounded whitespace-nowrap opacity-0 invisible transition-all duration-150',
          positionStyles[position],
          'group-hover:opacity-100 group-hover:visible group-focus-visible:opacity-100 group-focus-visible:visible',
        )}
        role="tooltip"
      >
        {content}
        <div className={cn('absolute size-0 border-4 border-transparent', arrowStyles[position])} />
      </div>
    </div>
  );
}

/**
 * Avatar with fallback initials
 */
export function Avatar({
  src,
  alt,
  name,
  size = 'md',
  className,
}: {
  src?: string;
  alt?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizeClasses = {
    sm: 'size-6 text-[0.5rem]',
    md: 'size-8 text-[0.625rem]',
    lg: 'size-10 text-[0.75rem]',
    xl: 'size-12 text-base',
  };

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={cn(
        'relative flex-shrink-0 overflow-hidden rounded-full bg-violet/20',
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt ?? name} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center font-bold text-violet">
          {initials}
        </div>
      )}
    </div>
  );
}

/**
 * Badge - for status indicators
 */
export function Badge({
  children,
  tone = 'neutral',
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
  dot?: boolean;
}) {
  const tones = {
    neutral: 'bg-line text-ink-dim',
    success: 'bg-neon/15 text-neon',
    warning: 'bg-amber/15 text-amber',
    error: 'bg-rose/15 text-rose',
    info: 'bg-cyan/15 text-cyan',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-semibold uppercase tracking-wide',
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
