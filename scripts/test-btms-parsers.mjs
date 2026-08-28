// Proves the BTMS parsers against the firm's own A&F exports and the
// acceptance figures in docs/reporting/BUILD.md §10. Nothing is written
// anywhere; the files are read where they sit.
//
//   node scripts/test-btms-parsers.mjs
//
// Point it somewhere else with:  BTMS_FIXTURES="D:/path/to/folder"

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseJournalListing, XLS_ROW_CAP } from '../src/reporting/lib/btms/journalListing.ts';
import { parseTrialBalance } from '../src/reporting/lib/btms/trialBalance.ts';
import { fingerprintAccounts } from '../src/reporting/lib/btms/fingerprint.ts';

const DIR = process.env.BTMS_FIXTURES
  || 'C:/DATA - PRIME & CALCULATE/2. PC PRIME & CALCULATE CONSULTANTS LTD/APP/CLIENTS DATA';

const LEDGERS = ['A&F detailed ledger 2024.xls', 'a&f detailed ledger 2025.xls', 'a&f detailed ledger 01 -07 2026.xls'];
const TB_JULY = 'a&f tb 07 2026 debtor suppliers in detail.xls';
const TRUNCATED = 'A&F Journal Lisitngs 01-2021 to 07-2026.xls';
const OTHER_CLIENT = 'gerondas - detailed ledger 2024 -2026 with t analysis.xls';

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`);
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const eur = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function rowsOf(file) {
  const path = join(DIR, file);
  if (!existsSync(path)) return null;
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: false });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
}

console.log('BTMS parsers, against the real A&F exports\n');

// ---------------------------------------------------------------- ledger
console.log('Journal listing');
const parsed = [];
for (const f of LEDGERS) {
  const rows = rowsOf(f);
  if (!rows) { failures++; console.log(`  FAIL missing fixture: ${f}`); continue; }
  const r = parseJournalListing(rows);
  parsed.push(r);
  const hardNotes = r.notes.filter((n) => n.kind !== 'unparsable-row');
  console.log(`  ${f}`);
  console.log(`     ${r.postings.length.toLocaleString('en-GB')} postings · ` +
    `${r.accounts.length} accounts · ${r.monthsCovered.length} months · ` +
    `debits ${eur(r.totals.debit)} credits ${eur(r.totals.credit)}`);
  console.log(`     skipped: ${r.skipped.accountTotals} account totals, ${r.skipped.openings} openings, ` +
    `${r.skipped.tagRows} tag rows`);
  ok(`${f} parses`, r.ok && hardNotes.length === 0, hardNotes.map((n) => n.message).join('; '));
}

if (parsed.length === LEDGERS.length) {
  const all = parsed.flatMap((p) => p.postings);
  const debit = Math.round(parsed.reduce((a, p) => a + p.totals.debit, 0) * 100) / 100;
  const credit = Math.round(parsed.reduce((a, p) => a + p.totals.credit, 0) * 100) / 100;
  // §10 counts the accounts the ledger DECLARES, not the ones that happen to
  // carry a posting in the period: 3.152 sections against 3.109 with movement,
  // the difference being accounts sitting on an opening balance alone.
  const accounts = new Set(parsed.flatMap((p) => p.accounts.map((a) => a.code)));
  const posted = new Set(all.map((p) => p.accountCode));
  const months = new Set(all.map((p) => p.periodMonth));
  const from2024 = all.filter((p) => p.periodMonth >= '2024-01-01');
  const months2024 = new Set(from2024.map((p) => p.periodMonth));

  console.log('\nAcceptance fixture (BUILD.md §10)');
  console.log(`     total ${all.length.toLocaleString('en-GB')} postings, ` +
    `${accounts.size.toLocaleString('en-GB')} accounts declared ` +
    `(${posted.size.toLocaleString('en-GB')} with movement), ${months.size} months, ` +
    `debits ${eur(debit)} credits ${eur(credit)}`);

  // 84.725 postings, Jan 2024 - Jul 2026, 3.152 accounts, debits = credits.
  ok('84.725 postings', from2024.length === 84725, `${from2024.length.toLocaleString('en-GB')}`);
  ok('31 months, Jan 2024 to Jul 2026',
    months2024.size === 31 && [...months2024].sort()[0] === '2024-01-01'
      && [...months2024].sort().at(-1) === '2026-07-01',
    `${months2024.size} months, ${[...months2024].sort()[0]} to ${[...months2024].sort().at(-1)}`);
  ok('3.152 accounts', accounts.size === 3152, String(accounts.size));
  ok('debits equal credits to zero', Math.abs(debit - credit) < 0.005, `difference ${eur(debit - credit)}`);

  // Every month must balance on its own, not just the file as a whole.
  const byMonth = new Map();
  for (const p of from2024) {
    const m = byMonth.get(p.periodMonth) ?? { d: 0, c: 0 };
    m.d += p.debit; m.c += p.credit; byMonth.set(p.periodMonth, m);
  }
  const offMonths = [...byMonth.entries()].filter(([, m]) => Math.abs(m.d - m.c) > 0.005);
  ok('every one of the 31 months balances', offMonths.length === 0,
    offMonths.map(([k, m]) => `${k} out by ${eur(m.d - m.c)}`).join(', '));

  // No posting may escape without the reference detail that makes it findable
  // in BTMS — §9 calls an exception that cannot be traced a defect.
  const untraceable = from2024.filter((p) => !p.journalCode || p.journalNo === null);
  ok('every posting carries journal code and number', untraceable.length === 0,
    `${untraceable.length} without`);
  const phantom = all.filter((p) => p.postedOn < '2000-01-01');
  ok('no phantom 1900 dates from tag rows', phantom.length === 0, `${phantom.length} found`);
}

// ------------------------------------------------------------------- cap
console.log('\nTruncation guard');
const bigRows = rowsOf(TRUNCATED);
if (!bigRows) console.log('  --   fixture not present, skipped');
else {
  const r = parseJournalListing(bigRows);
  ok('the 65.536-row export is refused, not imported',
    !r.ok && r.notes.some((n) => n.kind === 'truncated') && r.postings.length === 0,
    `${bigRows.length.toLocaleString('en-GB')} rows, cap ${XLS_ROW_CAP.toLocaleString('en-GB')}`);
}

// ---------------------------------------------------------- trial balance
console.log('\nTrial balance, July 2026');
const tbRows = rowsOf(TB_JULY);
if (!tbRows) { failures++; console.log(`  FAIL missing fixture: ${TB_JULY}`); }
else {
  const tb = parseTrialBalance(tbRows);
  console.log(`     ${tb.rows.length} accounts · debit ${eur(tb.reportTotal?.debit ?? 0)} · ` +
    `credit ${eur(tb.reportTotal?.credit ?? 0)} · detailed: ${tb.detailed}`);
  ok('parses and proves against its own Report Total', tb.ok,
    tb.notes.map((n) => n.message).join('; '));
  ok('trial balance is 1.090.456,09 each side',
    Math.abs((tb.reportTotal?.debit ?? 0) - 1090456.09) < 0.005
    && Math.abs((tb.reportTotal?.credit ?? 0) - 1090456.09) < 0.005,
    `${eur(tb.reportTotal?.debit ?? 0)} / ${eur(tb.reportTotal?.credit ?? 0)}`);
  ok('debtors and creditors are in detail', tb.detailed === true);

  // §10: journal movement 1.090.459,41 against a trial balance of
  // 1.090.456,09, and exactly ONE account differs — 7281 Electricity and
  // Heat, by 3,32 on both sides.
  if (parsed.length === LEDGERS.length) {
    const jul = parsed.flatMap((p) => p.postings).filter((p) => p.periodMonth === '2026-07-01');
    const jd = Math.round(jul.reduce((a, p) => a + p.debit, 0) * 100) / 100;
    const jc = Math.round(jul.reduce((a, p) => a + p.credit, 0) * 100) / 100;
    console.log(`     July journal movement: debit ${eur(jd)} credit ${eur(jc)}`);
    ok('July journal movement is 1.090.459,41 each side',
      Math.abs(jd - 1090459.41) < 0.005 && Math.abs(jc - 1090459.41) < 0.005, `${eur(jd)} / ${eur(jc)}`);

    const byAcct = new Map();
    for (const p of jul) {
      const a = byAcct.get(p.accountCode) ?? { d: 0, c: 0 };
      a.d += p.debit; a.c += p.credit; byAcct.set(p.accountCode, a);
    }
    const tbByAcct = new Map(tb.rows.map((r) => [r.accountCode, r]));
    const diffs = [];
    for (const [code, a] of byAcct) {
      const t = tbByAcct.get(code);
      if (!t) { diffs.push({ code, why: 'not on the trial balance', d: a.d, c: a.c }); continue; }
      if (Math.abs(a.d - t.debit) > 0.005 || Math.abs(a.c - t.credit) > 0.005) {
        diffs.push({ code, why: 'differs', d: a.d - t.debit, c: a.c - t.credit });
      }
    }
    console.log('     accounts differing from the trial balance: ' +
      (diffs.length ? diffs.map((x) => `${x.code} (${x.why} ${eur(x.d)}/${eur(x.c)})`).join(', ') : 'none'));
    ok('exactly one account differs, 7281 by 3,32 on both sides',
      diffs.length === 1 && diffs[0].code === '7281'
      && Math.abs(diffs[0].d - 3.32) < 0.005 && Math.abs(diffs[0].c - 3.32) < 0.005,
      `${diffs.length} differing`);
  }
}

// ----------------------------------------------------------- fingerprint
console.log('\nFingerprint');
if (parsed.length === LEDGERS.length) {
  const af = new Set(parsed.flatMap((p) => p.accounts.map((a) => a.code)));
  const own = fingerprintAccounts(af, af);
  ok('A&F\'s own file is accepted', own.accepted && own.overlap === 1, own.reason);

  const otherRows = rowsOf(OTHER_CLIENT);
  if (!otherRows) console.log('  --   other-client fixture not present, skipped');
  else {
    const other = parseJournalListing(otherRows);
    const codes = new Set(other.accounts.map((a) => a.code));
    const fp = fingerprintAccounts(codes, af);
    ok('another client\'s ledger is refused', !fp.accepted,
      `${fp.matched} of ${fp.total} codes matched`);
  }

  const first = fingerprintAccounts(af, new Set());
  ok('a client\'s first ever import is allowed through', first.accepted, first.reason);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
