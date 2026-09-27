'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { scorePassword, strengthColor, type StrengthLabel } from '@/shared/password-policy';

/**
 * Form field.
 *
 * A single implementation for text, password and textarea so that the three
 * accessibility obligations are met in one place and cannot be forgotten on a
 * new form:
 *  1. The `<label>` is wired to the input with a generated id, so clicking the
 *     label focuses the field and screen readers announce the right name.
 *  2. The error is referenced by `aria-describedby` and the input is marked
 *     `aria-invalid`, so the failure is announced with the field.
 *  3. The error text is a real DOM node with `role="alert"`, not just a red
 *     border, because a colour change alone conveys nothing to a blind user.
 */

export interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  error?: string | undefined;
  hint?: ReactNode;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  minLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  spellCheck?: boolean;
  /** Appended inside the input row, e.g. a show/hide toggle. */
  trailing?: ReactNode;
  className?: string;
}

export function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  autoComplete,
  autoFocus,
  required,
  disabled,
  maxLength,
  minLength,
  inputMode,
  spellCheck,
  trailing,
  className,
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={type}
          className={cn('field', trailing ? 'pr-11' : null)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          // Intentionally autofocuses: this is the first field of a dedicated
          // single-purpose page, and the alternative is a tab stop before any
          // content. Every other page omits it.
          autoFocus={autoFocus}
          required={required}
          disabled={disabled}
          maxLength={maxLength}
          minLength={minLength}
          inputMode={inputMode}
          spellCheck={spellCheck}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
        ) : null}
      </div>

      {/*
        The hint occupies the same element in both states so the row does not
        jump when an error appears or clears, and so `aria-describedby` never
        points at an id that is not in the DOM. When there is an error the hint
        becomes screen-reader-only, because the error already says what is wrong.
      */}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-rose">
          <span aria-hidden="true">▸</span>
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}

      {hint && error ? (
        <span id={hintId} className="sr-only">
          {typeof hint === 'string' ? hint : ''}
        </span>
      ) : null}
    </div>
  );
}

const LABELS: Record<StrengthLabel, string> = {
  empty: '',
  'very-weak': 'Very weak',
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

const SR_ONLY: Record<StrengthLabel, string> = {
  empty: 'Password strength: not yet entered',
  'very-weak': 'Password strength: very weak',
  weak: 'Password strength: weak',
  fair: 'Password strength: fair',
  good: 'Password strength: good',
  strong: 'Password strength: strong',
};

/**
 * Live strength meter.
 *
 * Recomputed on every keystroke from the shared policy, so the meter and the
 * submit button's validity come from the same function. The visual bar is
 * `aria-hidden`; the `sr-only` text carries the state for assistive tech,
 * because a gradient filling up conveys nothing to a screen reader.
 */
export function PasswordStrength({
  password,
  context,
  id,
}: {
  password: string;
  context?: { username?: string; email?: string };
  id?: string;
}) {
  const strength = scorePassword(password, context ?? {});

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((step) => (
          <div
            key={step}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-200',
              step < strength.score ? strengthColor(strength.label) : 'bg-line',
            )}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <p className="sr-only" id={id}>
          {SR_ONLY[strength.label]}
        </p>
        {LABELS[strength.label] ? (
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
            {LABELS[strength.label]}
          </p>
        ) : (
          <p />
        )}
        {strength.acceptable ? (
          <p className="text-[0.6875rem] text-neon">Meets policy</p>
        ) : strength.hint ? (
          <p className="text-right text-[0.6875rem] text-amber">{strength.hint}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Reveal toggle.
 *
 * A `<button type="button">` inside the field row. It deliberately does not
 * submit the surrounding form.
 */
export function PasswordReveal({
  revealed,
  onToggle,
  label,
}: {
  revealed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={revealed}
      aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
      className="flex size-8 items-center justify-center rounded text-xs font-semibold uppercase text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
    >
      {revealed ? 'Hide' : 'Show'}
    </button>
  );
}

/** A controlled password field with reveal + strength, used by every auth form. */
export function PasswordField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  context,
  disabled,
  required,
  meter = false,
  placeholder,
  minLength,
  autoFocus,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  autoComplete: string;
  context?: { username?: string; email?: string };
  disabled?: boolean;
  required?: boolean;
  meter?: boolean;
  placeholder?: string;
  minLength?: number;
  autoFocus?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const strengthId = `${name}-strength`;

  return (
    <div>
      <Field
        label={label}
        name={name}
        value={value}
        onChange={onChange}
        type={revealed ? 'text' : 'password'}
        placeholder={placeholder}
        error={error}
        hint={hint}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        spellCheck={false}
        trailing={
          <PasswordReveal
            revealed={revealed}
            onToggle={() => setRevealed((r) => !r)}
            label={label}
          />
        }
      />
      {meter ? <PasswordStrength password={value} context={context} id={strengthId} /> : null}
    </div>
  );
}
