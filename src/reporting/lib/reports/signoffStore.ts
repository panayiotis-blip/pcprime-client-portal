// Sign-offs, kept where the practice can see them.
//
// Two things in the template are signed: an exception on Needs attention
// ("cleared, with a reason"), and a step on the monthly audit's working-paper
// programme (prepared by, reviewed by). Both were browser storage — and the
// working papers were browser storage under ONE key for every client,
//
//   const WPKEY="pcp-wp-af";
//
// which is the same fault the budget had: sign a step off against one client and
// it showed signed against every other. A sign-off is somebody putting their
// name to work having been done. It cannot live in one person's browser.
//
// reporting.exception_signoff already exists and is keyed (client_id, ex_key).
// The review's own key is the template's exKey — check|month|account|ref|amount
// — and a working paper's is namespaced so the two cannot collide:
//
//   wp|<month>|<ref>|prep      the preparer's signature
//   wp|<month>|<ref>|rev       the reviewer's
//
// Who and when come from signed_by and signed_at rather than from what the
// browser typed, so a name on a working paper is the account that signed it.

import { supabase } from '../../../lib/supabase';

const rep = () => supabase.schema('reporting');

export type ReviewSignoff = { reason?: string; note?: string; by?: string; on?: string };
/** The template's shape: R[exKey] = {reason, note, by, on}. */
export type ReviewMap = Record<string, ReviewSignoff>;
/** The template's shape: WP[month][ref] = { prep: {by,on}, rev: {by,on} }. */
export type WorkingPapers = Record<string, Record<string, { prep?: { by?: string; on?: string }; rev?: { by?: string; on?: string } }>>;

export const WP_PREFIX = 'wp|';
const wpKey = (month: string, ref: string, side: 'prep' | 'rev') => `${WP_PREFIX}${month}|${ref}|${side}`;

type Row = { client_id: number; ex_key: string; reason: string | null; note: string | null };

/**
 * Replace one kind of sign-off for a client.
 *
 * `belongs` says which of the client's stored keys this call is responsible
 * for, so saving the working papers cannot delete the review's sign-offs and
 * the other way round. Rows are written before the stale ones are removed: the
 * other order leaves a moment with no sign-offs at all, and a failure inside it
 * loses somebody's name against work they did.
 */
async function replace(clientId: number, rows: Row[], belongs: (key: string) => boolean): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const now = new Date().toISOString();

  if (rows.length) {
    // signed_at is left as it stands where a row already exists — re-saving the
    // map must not restamp a signature somebody gave last month.
    const held = await rep().from('exception_signoff')
      .select('ex_key, signed_by, signed_at').eq('client_id', clientId);
    if (held.error) throw new Error(`Reading the sign-offs: ${held.error.message}`);
    const before = new Map(((held.data ?? []) as { ex_key: string; signed_by: string | null; signed_at: string }[])
      .map((r) => [r.ex_key, r]));

    const payload = rows.map((r) => {
      const prior = before.get(r.ex_key);
      return {
        ...r,
        signed_by: prior?.signed_by ?? me.user?.id ?? null,
        signed_at: prior?.signed_at ?? now,
      };
    });
    const { error } = await rep().from('exception_signoff')
      .upsert(payload, { onConflict: 'client_id,ex_key' });
    if (error) throw new Error(`The sign-off was not saved: ${error.message}`);
  }

  const held = await rep().from('exception_signoff')
    .select('ex_key').eq('client_id', clientId);
  if (held.error) throw new Error(`The sign-off was saved but not tidied: ${held.error.message}`);

  const wanted = new Set(rows.map((r) => r.ex_key));
  const stale = ((held.data ?? []) as { ex_key: string }[])
    .map((r) => r.ex_key)
    .filter((k) => belongs(k) && !wanted.has(k));
  if (!stale.length) return;

  const { error } = await rep().from('exception_signoff').delete()
    .eq('client_id', clientId).in('ex_key', stale);
  if (error) throw new Error(`A withdrawn sign-off was not removed: ${error.message}`);
}

export async function saveReviewSignoffs(clientId: number, map: ReviewMap): Promise<void> {
  const rows: Row[] = Object.entries(map ?? {}).map(([ex_key, s]) => ({
    client_id: clientId,
    ex_key,
    reason: s?.reason ?? null,
    note: s?.note || null,
  }));
  await replace(clientId, rows, (k) => !k.startsWith(WP_PREFIX));
}

export async function saveWorkingPapers(clientId: number, wp: WorkingPapers): Promise<void> {
  const rows: Row[] = [];
  for (const [month, steps] of Object.entries(wp ?? {})) {
    for (const [ref, sides] of Object.entries(steps ?? {})) {
      for (const side of ['prep', 'rev'] as const) {
        if (!sides?.[side]) continue;
        rows.push({
          client_id: clientId,
          ex_key: wpKey(month, ref, side),
          reason: side === 'prep' ? 'prepared' : 'reviewed',
          note: null,
        });
      }
    }
  }
  await replace(clientId, rows, (k) => k.startsWith(WP_PREFIX));
}

/** Everything signed for this client, in the two shapes the template reads. */
export async function loadSignoffs(clientId: number): Promise<{ review: ReviewMap; wp: WorkingPapers }> {
  const { data, error } = await rep().from('exception_signoff')
    .select('ex_key, reason, note, signed_by, signed_at').eq('client_id', clientId);
  if (error) throw new Error(`Reading the sign-offs: ${error.message}`);
  const rows = (data ?? []) as {
    ex_key: string; reason: string | null; note: string | null;
    signed_by: string | null; signed_at: string;
  }[];
  if (!rows.length) return { review: {}, wp: {} };

  // One lookup for the names, not one per signature.
  const ids = [...new Set(rows.map((r) => r.signed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const who = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
    for (const p of (who.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      names.set(p.id, p.full_name || p.email || '');
    }
  }
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? '') : '');
  const dayOf = (iso: string) => String(iso).slice(0, 10);

  const review: ReviewMap = {};
  const wp: WorkingPapers = {};
  for (const r of rows) {
    if (r.ex_key.startsWith(WP_PREFIX)) {
      const [, month, ref, side] = r.ex_key.split('|');
      if (!month || !ref || (side !== 'prep' && side !== 'rev')) continue;
      if (!wp[month]) wp[month] = {};
      if (!wp[month][ref]) wp[month][ref] = {};
      wp[month][ref][side] = { by: nameOf(r.signed_by), on: dayOf(r.signed_at) };
    } else {
      review[r.ex_key] = {
        reason: r.reason ?? '',
        note: r.note ?? '',
        by: nameOf(r.signed_by),
        on: dayOf(r.signed_at),
      };
    }
  }
  return { review, wp };
}
