import 'server-only';

import { env } from '@/server/config/env';
import type { MailMessage } from './service';
import { sendMail } from './service';

/**
 * Transactional message templates.
 *
 * Every template is plain text, states why the player received it, and — for
 * anything security relevant — tells them what to do if they did not ask for it.
 * The copy never confirms whether an address is registered; that decision
 * belongs to the endpoint, not the template.
 */

function footer(): string {
  return [
    '',
    '--',
    'CYBERGRID',
    'You received this because someone used this address on a CYBERGRID account.',
    'If that was not you, no action is needed — the link expires on its own and',
    'the address was never activated.',
    '',
    `Reference: ${env().APP_URL}`,
  ].join('\n');
}

function buildUrl(path: string, token: string): string {
  return `${env().APP_URL}${path}?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail(params: {
  to: string;
  username: string;
  token: string;
  userId: string;
}): Promise<boolean> {
  const url = buildUrl('/verify-email', params.token);
  const message: MailMessage = {
    kind: 'verification',
    to: params.to,
    userId: params.userId,
    subject: 'Confirm your CYBERGRID operator account',
    actionUrl: url,
    text: [
      `Operator ${params.username},`,
      '',
      'Welcome to CYBERGRID. Confirm this address to activate your account and',
      'unlock the Networking campaign.',
      '',
      `Confirm your address:`,
      url,
      '',
      `This link can be used once and expires in 24 hours.`,
      footer(),
    ].join('\n'),
  };
  return sendMail(message);
}

export async function sendPasswordResetEmail(params: {
  to: string;
  username: string;
  token: string;
  userId: string;
}): Promise<boolean> {
  const url = buildUrl('/reset-password', params.token);
  const message: MailMessage = {
    kind: 'password-reset',
    to: params.to,
    userId: params.userId,
    subject: 'Reset your CYBERGRID password',
    actionUrl: url,
    text: [
      `Operator ${params.username},`,
      '',
      'A password reset was requested for your CYBERGRID account.',
      '',
      'Reset your password:',
      url,
      '',
      'This link can be used once and expires in 1 hour. If you did not request',
      'a reset, ignore this message — your password has not changed and your',
      'existing sessions remain active.',
      footer(),
    ].join('\n'),
  };
  return sendMail(message);
}

export async function sendWelcomeEmail(params: {
  to: string;
  username: string;
  userId: string;
}): Promise<boolean> {
  const message: MailMessage = {
    kind: 'welcome',
    to: params.to,
    userId: params.userId,
    subject: 'Your CYBERGRID clearance is active',
    text: [
      `Welcome aboard, ${params.username}.`,
      '',
      'Your account is active. Start in the Atrium and speak with VERA — she',
      'will walk you through the first mission on Network Basics.',
      '',
      'One rule before you begin: the grid does not grade attempts. Guessing is',
      'part of the method. Read the concept, then try again.',
      footer(),
    ].join('\n'),
  };
  return sendMail(message);
}

export async function sendSecurityAlertEmail(params: {
  to: string;
  username: string;
  userId: string;
  detail: string;
}): Promise<boolean> {
  const message: MailMessage = {
    kind: 'security-alert',
    to: params.to,
    userId: params.userId,
    subject: 'Security notice for your CYBERGRID account',
    text: [
      `Operator ${params.username},`,
      '',
      `We detected the following on your account: ${params.detail}`,
      '',
      'If this was you, no action is required.',
      'If it was not, reset your password immediately and revoke any active',
      'sessions from your account settings.',
      footer(),
    ].join('\n'),
  };
  return sendMail(message);
}
