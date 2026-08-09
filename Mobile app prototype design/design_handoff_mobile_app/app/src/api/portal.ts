/**
 * The seam between the app and `portal.primeandcalculate.com`.
 *
 * Everything here is mock. The portal remains the system of record for
 * documents, filings and messages — when the real API is wired up, these
 * functions become network calls and nothing above them has to change shape.
 *
 * Notes for that pass:
 * - Auth is SSO with the portal; biometric unlock should re-use a stored
 *   refresh token rather than asking for a second credential.
 * - The upload endpoint must accept both camera capture and file-picker input.
 * - Messages need a push notification on inbound, not polling.
 */

import * as mock from '../data/mock';
import * as staff from '../data/staff';
import { Client, ClientDocument, Filing, Message, Role, StaffTask } from '../data/types';

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

export type SignInResult = { ok: true; role: Role } | { ok: false; error: string };

/** Firm addresses belong to accountants; everyone else is a client. */
const STAFF_DOMAIN = '@primeandcalculate.com';

/**
 * Prototype validation, kept exactly as specified in the handoff: an email
 * needs an `@` with at least one character before it and a `.` at least two
 * characters after it, and no spaces; a password needs six characters.
 *
 * The role comes back with the session because staff mode must be gated by
 * who you are, not by a button. Deriving it from the email domain is the mock
 * stand-in for the portal telling us.
 *
 * TODO: replace with the portal's auth endpoint.
 */
export function signIn(email: string, password: string): SignInResult {
  const at = email.indexOf('@');
  const dot = email.indexOf('.', at);

  if (at < 1 || dot < at + 2 || email.includes(' ')) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  return { ok: true, role: roleFor(email) };
}

export function roleFor(email: string): Role {
  return email.trim().toLowerCase().endsWith(STAFF_DOMAIN) ? 'staff' : 'client';
}

export function loadTasks(): StaffTask[] {
  return staff.staffTasks;
}

export function loadClients(): Client[] {
  return staff.clients;
}

export function findClient(id: string | undefined): Client | undefined {
  return staff.clients.find((client) => client.id === id);
}

export function loadDocuments(): ClientDocument[] {
  return mock.documents;
}

/**
 * Stands in for a real upload. The source (camera, file picker, email import)
 * is ignored here but is what the real endpoint will branch on.
 */
export function uploadDocument(_source: string): ClientDocument {
  return { ...mock.uploadedDocument, id: nextId('upload') };
}

export function loadFilings(): Filing[] {
  return mock.filings;
}

export function loadThread(): Message[] {
  return mock.thread;
}

export function composeOutgoing(text: string): Message {
  return { id: nextId('out'), from: 'me', text };
}

/**
 * Prototype-only: the accountant "replies" 1400ms after you send. Delete this
 * when the real message API and its push notification are in place.
 */
export function composeCannedReply(): Message {
  return { id: nextId('in'), from: 'them', text: mock.cannedReply };
}

export const CANNED_REPLY_DELAY = 1400;
