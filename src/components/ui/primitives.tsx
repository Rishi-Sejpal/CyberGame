import { cn } from '@/lib/utils';

/**
 * Visual primitives.
 *
 * These are deliberately thin. The design language lives in `globals.css`
 * (`.btn`, `.panel`, `.field`, `.chip`), so these components exist to make the
 * semantics correct and the accessibility right, not to re-declare the styling.
 * Every interactive element here is a real `<button>`/`<input>` with the right
 * ARIA and disabled handling, which is what keeps keyboard and screen-reader
 * behaviour working.
 */

type ButtonVariant = 'primary' | 'violet' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  violet: 'btn-violet',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: '',
  lg: 'px-6 py-3 text-base',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without unmounting the label. */
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // Forms default to `submit`; an unlabelled icon button inside a form
      // submitting by accident is a real bug, so the default is explicit.
      type={type}
      // `disabled` alone removes the button from the tab order mid-submit, which
      // loses focus. `aria-disabled` keeps it focusable while inert.
      disabled={disabled || loading}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      className={cn('btn', VARIANT_CLASS[variant], SIZE_CLASS[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner className="shrink-0" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      // Decorative: the accessible state lives on the button's `aria-busy`.
      aria-hidden="true"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONE_CLASS: Record<AlertTone, string> = {
  info: 'border-cyan/40 bg-cyan/8 text-cyan',
  success: 'border-neon/40 bg-neon/8 text-neon',
  warning: 'border-amber/40 bg-amber/8 text-amber',
  error: 'border-rose/50 bg-rose/10 text-rose',
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Form and page feedback.
 *
 * `role="alert"` on the error tone is what makes a screen reader announce the
 * message the moment it appears — without it the failure is silent to anyone
 * not looking at the exact pixel.
 */
export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  if (!children && !title) return null;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('rounded-lg border px-3.5 py-3 text-sm', TONE_CLASS[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}

export function Panel({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
}) {
  return <Tag className={cn('panel', className)}>{children}</Tag>;
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm leading-tight">{title}</h2>
        {description ? <p className="mt-1 text-xs text-ink-dim">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'neon' | 'cyan' | 'amber' | 'rose' | 'violet' | 'lime';
  className?: string;
}) {
  const toneClass: Record<string, string> = {
    neutral: 'text-ink-faint',
    neon: 'text-neon',
    cyan: 'text-cyan',
    amber: 'text-amber',
    rose: 'text-rose',
    violet: 'text-violet',
    lime: 'text-lime',
  };
  return <span className={cn('chip', toneClass[tone], className)}>{children}</span>;
}

/** A labelled statistic used across the dashboard. */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'neutral' | 'neon' | 'cyan' | 'amber';
}) {
  const valueTone = { neutral: 'text-ink', neon: 'text-neon', cyan: 'text-cyan', amber: 'text-amber' }[tone];
  return (
    <div className="panel-inset px-4 py-3">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className={cn('hud-text mt-1.5 text-xl', valueTone)}>{value}</p>
      {hint ? <p className="mt-1 text-[0.6875rem] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-abyss ring-1 ring-line', className)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-neon-dim to-neon transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid-noise flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-display text-sm text-ink">{title}</p>
      {description ? <p className="max-w-sm text-xs text-ink-dim">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
