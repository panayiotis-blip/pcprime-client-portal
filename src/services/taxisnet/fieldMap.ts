// Declarative map: calculator input fields → official TaxisNet field keys.
//
// `source` is a path into the saved tax_returns.input_data (the calculator's
// getInputState() shape). Flat entries map one value to one key; grid entries
// map an array (e.g. employments[]) to repeating <grid> rows, one column key
// per element property.
//
// `confidence`:
//   'confirmed' — the key↔meaning is proven by a real filing: either the value
//                 is self-identifying (a T.I.C., a name, a date) or it checks
//                 out arithmetically against a statutory rate in the same row.
//   'inferred'  — deduced from the TD1 PDF layout / XSD position; must be
//                 confirmed by a real TaxisNet test import. Surfaced as a
//                 warning by the validator so nothing unverified ships silently.
//
// Coverage grows incrementally; every key is checked against keyCatalogue at
// build time, so an out-of-schema key can never reach the file.
//
// XML COLUMN NUMBERS ARE NOT FORM COLUMN NUMBERS. The printed TD1 numbers the
// columns a person fills in; the schema numbers the fields it carries, and the
// two drift apart wherever the form splits one column into two (Part 4.C col 5
// = cost + area → c5 + c6), adds a lettered field (c3a, c9a, c5a) or omits a
// computed total. Assuming they matched is what put gross rents in the lessee
// columns and SDC/GHS one place left, both fixed 2026-08-03 against the real
// filings in supabase/xsd-tep-ext-2024/Samples. Check a column against a
// sample before trusting the form's numbering.
//
// Evidence for the 2026-08-03 corrections (scripts/audit-taxisnet-map.mjs and
// scripts/_taxisnet-rows.mjs reproduce it):
//   · rents row: gross 250 → c16 5,63 (2.25% = SDC on 75%) and c17 6,63
//     (2.65% = GHS); gross 1300 → 29,26 / 34,46. c7/c8 hold a T.I.C. and a
//     lessee name, c9 an ownership share of 16/50, c10 the gross rent.
//   · employments: gross 11000 → c8 291,5, exactly 2.65%; the same figure is
//     the GHS line of the contributions block, and the totals row carries it
//     in the GHS position with the tax position empty. c8 is GHS, not tax.
//   · dividends: gross 4125 → c5 701,24 (17% SDC) and c5a 109,3 (2.65% GHS);
//     3025 → 514,24 / 80,15. Gross 30 → c6 8,99 (30% withheld abroad).

import type { FieldKind } from './format';

//   'derived'   — the schema's key set for a table matches the printed form's
//                 column list one-for-one, in order, and this key falls in a
//                 position fixed by that mapping. Stronger than a guess and
//                 weaker than a filing: the ordering rule itself is proven (see
//                 the dividends table, where all nine columns line up and four
//                 are confirmed arithmetically), but this particular column has
//                 never been seen carrying a value.
export type Confidence = 'confirmed' | 'derived' | 'inferred';

export interface FlatEntry {
  key: string;
  source: string;
  kind: FieldKind;
  required?: boolean;
  confidence: Confidence;
  // Optional guard: emit this field only when the predicate passes (gets the
  // whole input_data). Used e.g. to route self-employed trade figures to the
  // in-Republic vs outside-Republic column block.
  when?: (input: any) => boolean;
}

export interface GridColEntry {
  col: string;       // e.g. 'c1' — appended to the grid id to form the key
  field: string;     // property name on each array element
  kind: FieldKind;
  required?: boolean;
  confidence: Confidence;
}

export interface GridEntry {
  gridId: string;    // e.g. 'epr1mm4tar1'
  source: string;    // array name in input_data, e.g. 'employments'
  cols: GridColEntry[];
  // Optional per-row guard: emit a row only when the predicate passes (gets the
  // array element). Used e.g. so the Part 5.D funds grid takes SI / provident /
  // medical fund rows but skips life-insurance rows, which belong elsewhere.
  rowFilter?: (el: any) => boolean;
}

export interface FormMap {
  ticSource: string;      // input_data path holding the taxpayer T.I.C.
  ticFieldKey: string;    // also echoed as a flat field (Part 1)
  flat: FlatEntry[];
  grids: GridEntry[];
}

// ---- epr1m — TD1 employee --------------------------------------------------
const EPR1M: FormMap = {
  ticSource: 'clientTIC',
  ticFieldKey: 'epr1mm1t0r1c1', // Part 1 taxpayer T.I.C. — confirmed (sample)
  flat: [],
  grids: [
    {
      // Part 4.A salaried services. Schema columns: c1 c2 c3 c3a c4 c5 c6 c7
      // c8 c9 c10 — eleven for the form's twelve slots, so one printed column
      // (the gross-emoluments total, which the Department computes) has no key.
      // c8 is GHS, PROVEN: the sample's 11000 gross carries 291,5 there, the
      // exact 2.65% that reappears as the GHS line of the contributions block,
      // while the totals row shows the tax position empty. Tax withheld is
      // therefore c7 — the only slot left, and still inferred.
      //
      // Benefits in kind have NO column: the form declares them as their own
      // line under code 7 or 9, so `bik` is deliberately not mapped. Mapping it
      // to c7 (as this did) silently filed benefits as tax deducted at source.
      gridId: 'epr1mm4tar1',
      source: 'employments',
      cols: [
        { col: 'c1', field: 'employerTic', kind: 'tic', confidence: 'confirmed' },
        { col: 'c2', field: 'employerName', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'confirmed' },
        { col: 'c4', field: 'periodMonths', kind: 'text', confidence: 'confirmed' },
        { col: 'c5', field: 'grossInRepublic', kind: 'money', confidence: 'confirmed' },
        { col: 'c6', field: 'grossOutsideRepublic', kind: 'money', confidence: 'derived' },
        { col: 'c7', field: 'taxWithheld', kind: 'money', confidence: 'derived' },
        { col: 'c8', field: 'ghsWithheld', kind: 'money', confidence: 'confirmed' },
      ],
    },
    {
      // Part 4.B pensions — grid tb. The schema has exactly c1–c6 and the form
      // prints exactly six columns: T.I.C. of the payer, name, code, pension
      // amount, tax withheld, GHS withheld (TD1A Part B1 sets them out with the
      // payer T.I.C. and name as one pair). One-for-one in order.
      gridId: 'epr1mm4tbr1',
      source: 'pensions',
      cols: [
        { col: 'c1', field: 'payerTic', kind: 'tic', confidence: 'derived' },
        { col: 'c2', field: 'payerName', kind: 'text', confidence: 'derived' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'derived' },
        { col: 'c4', field: 'amount', kind: 'money', confidence: 'derived' },
        { col: 'c5', field: 'taxWithheld', kind: 'money', confidence: 'derived' },
        { col: 'c6', field: 'ghsWithheld', kind: 'money', confidence: 'derived' },
      ],
    },
    {
      // Part 4.C rents — grid tc. Read straight off the real filing, where a
      // row is self-describing: c2 a property code, c3/c4 two dates, c5/c6 the
      // cost and area the form prints as one column, c7 a T.I.C., c8 a lessee
      // name, c9 an ownership share (16 / 50), c10 the gross rent, and c16/c17
      // the withholdings — 250 rent → 5,63 and 6,63, i.e. 2.25% (SDC on 75%)
      // and 2.65% (GHS) to the cent.
      //
      // This was previously mapped as though schema columns matched the form's
      // printed numbers. They do not: gross rents were being filed into the
      // lessee's T.I.C. and name, the ownership share into a date, and SDC/GHS
      // one column to the left of where they belong.
      //
      // NOT MAPPED, because the calculator does not collect them: c4 hand-over
      // date, c5 cost of acquisition, c6 area m², c9a ownership at 31.12, c15
      // tax paid outside the Republic. Cost drives the capital allowance, so
      // it is the one worth adding to the rental form next.
      gridId: 'epr1mm4tcr1',
      source: 'rentalProperties',
      cols: [
        { col: 'c1', field: 'registrationNo', kind: 'text', confidence: 'derived' },
        { col: 'c2', field: 'propertyTypeCode', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'acquisitionDate', kind: 'date', confidence: 'confirmed' },
        { col: 'c7', field: 'lesseeTic', kind: 'tic', confidence: 'confirmed' },
        { col: 'c8', field: 'lesseeName', kind: 'text', confidence: 'confirmed' },
        { col: 'c9', field: 'ownershipShare', kind: 'text', confidence: 'confirmed' },
        { col: 'c10', field: 'annualGrossInRepublic', kind: 'money', confidence: 'confirmed' },
        { col: 'c11', field: 'annualGrossOutsideRepublic', kind: 'money', confidence: 'derived' },
        { col: 'c12', field: 'capitalAllowances', kind: 'money', confidence: 'derived' },
        { col: 'c13', field: 'interestPayable', kind: 'money', confidence: 'derived' },
        { col: 'c16', field: 'sdcWithheld', kind: 'money', confidence: 'confirmed' },
        { col: 'c17', field: 'ghsWithheld', kind: 'money', confidence: 'confirmed' },
      ],
    },
    {
      // Part 4.E interest — grid te. The form prints: 1 T.I.C., 2 name of
      // debtor or bank, 3 code, 4 gross interest, 5 tax paid outside the
      // Republic, 6 defence withheld, 7 GHS withheld. c5 is CONFIRMED as gross
      // by the filing, which fixes the schema one place ahead of the form from
      // there on, so 5/6/7 land on c6/c7/c7a.
      //
      // This corrects a swap: SDC was mapped to c6 and foreign tax to c7, which
      // filed defence contribution as tax paid abroad and vice versa — two
      // figures that pull opposite ways in the computation.
      gridId: 'epr1mm4ter1',
      source: 'interestSources',
      cols: [
        { col: 'c1', field: 'debtorTic', kind: 'tic', confidence: 'derived' },
        { col: 'c2', field: 'debtorName', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'confirmed' },
        { col: 'c5', field: 'grossInterest', kind: 'money', confidence: 'confirmed' },
        { col: 'c6', field: 'taxPaidOutside', kind: 'money', confidence: 'derived' },
        { col: 'c7', field: 'sdcWithheld', kind: 'money', confidence: 'derived' },
        { col: 'c7a', field: 'ghsWithheld', kind: 'money', confidence: 'derived' },
        // c11 = security / account identifier (e.g. VUTY, an IBKR account, an
        // ISIN). Confirmed by the real epr1m sample; maps to the portal's
        // `accountType` free-text field. c10 (country) is a coded value
        // (OECD605) so it stays unmapped until we capture the coded form.
        { col: 'c11', field: 'accountType', kind: 'text', confidence: 'confirmed' },
      ],
    },
    {
      // Part 4.F dividends — grid tz. Every column now checks out against the
      // real filing: Cyprus-company rows carry a T.I.C. in c1 and a name in c2,
      // and the money columns land on the statutory rates — gross 4125 → c5
      // 701,24 (17% SDC) and c5a 109,3 (2.65% GHS); 3025 → 514,24 / 80,15. c6
      // is tax withheld abroad: a 30 dividend carries 8,99, the US 30%.
      // c1b (a country/source code, 6 or 600 in the filing) is not mapped —
      // the portal captures country as free text, not in the coded form.
      gridId: 'epr1mm4tzr1',
      source: 'dividendSources',
      cols: [
        { col: 'c1', field: 'payerTic', kind: 'tic', confidence: 'confirmed' },
        { col: 'c2', field: 'businessName', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'confirmed' },
        { col: 'c4', field: 'grossDividend', kind: 'money', confidence: 'confirmed' },
        { col: 'c5', field: 'sdcWithheld', kind: 'money', confidence: 'confirmed' },
        { col: 'c5a', field: 'ghsWithheld', kind: 'money', confidence: 'confirmed' },
        { col: 'c6', field: 'taxPaidOutside', kind: 'money', confidence: 'confirmed' },
        { col: 'c7', field: 'receiptDate', kind: 'date', confidence: 'confirmed' },
      ],
    },
    {
      // Part 5.D — contributions to Social Insurance / provident / medical
      // funds. Column layout CONFIRMED by the real epr1m sample: c1 fund TIC,
      // c2 fund name, c3 type code, c7 amount paid. The sample's c3 codes even
      // line up with the portal's LIFE_SI_PENSION_CODES (2 = Social Insurance,
      // 4 = medical/health). Life-insurance rows (code '3') are excluded — they
      // carry sum-assured logic and are relieved separately, not as a fund row.
      gridId: 'epr1mm5tdr1',
      source: 'lifeSiPensionFunds',
      rowFilter: (el: any) => String(el?.code ?? '') !== '3',
      cols: [
        { col: 'c1', field: 'fundTic', kind: 'tic', confidence: 'confirmed' },
        { col: 'c2', field: 'fundName', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'confirmed' },
        { col: 'c7', field: 'amountPaid', kind: 'money', confidence: 'confirmed' },
      ],
    },
  ],
};

// ---- epr1a — TD1A self-employed --------------------------------------------
// Self-employed schedules, read against the official TD1A form (Part 4
// Α1/Α2/Α3). Neither filing populates them, but in each table the schema's key
// set and the form's printed columns match one-for-one in order, and the
// lettered keys sit exactly where the form letters its own numbering (r1a ↔
// box 7a, r5a ↔ box 15 beside 14). Marked derived on that basis; a TaxisNet
// import would move them to confirmed.
//
//   Α1  activity → r1c1 · 7a occupational category → r1ac1
//       in the Republic 7-10 → r2c1-c4
//       outside 11-13 → r4c1-c3 · 14 → r5c1 · 15 tax paid → r5ac1
//   Α2  1-4 gains/losses → r1c2,r1c3,r2c2,r2c3 · 5 T.I.C. → r3c1 · 6 country → r4c1
//   Α3  1 T.I.C. → c1 · 2 name → c1b · 3 code → c2 · 4 occupational → c2a
//       5 % → c2b · 6 salary → c3 · 7 interest on capital → c4
//       8 trading income → c5 · 9 trading loss → c6 · 10 tax withheld → c7
//       11 tax paid outside → c7b   (c2a and c7b are not collected by the portal)
const seActivity = (field: string) => `selfEmployedActivities.0.${field}`;
const isOutside = (input: any) => !!input?.selfEmployedActivities?.[0]?.isOutsideRepublic;
const isInRepublic = (input: any) => !isOutside(input);

const EPR1A: FormMap = {
  ticSource: 'clientTIC',
  ticFieldKey: 'epr1am1t0r1c1', // Part 1 taxpayer T.I.C. — confirmed (sample)
  flat: [
    // Part 4.Α1 — Trade / industry / profession (single activity).
    { key: 'epr1am4ta1r1c1', source: seActivity('mainCategory'), kind: 'text', confidence: 'derived' },
    { key: 'epr1am4ta1r1ac1', source: seActivity('occupationalCategory'), kind: 'text', confidence: 'derived' },
    // Income arising IN the Republic (r2: profit / loss / losses b/f 1997 / losses >5y).
    { key: 'epr1am4ta1r2c1', source: seActivity('taxableProfit'), kind: 'money', confidence: 'derived', when: isInRepublic },
    { key: 'epr1am4ta1r2c2', source: seActivity('lossCurrentYear'), kind: 'money', confidence: 'derived', when: isInRepublic },
    { key: 'epr1am4ta1r2c3', source: seActivity('lossesBfFrom1997'), kind: 'money', confidence: 'derived', when: isInRepublic },
    { key: 'epr1am4ta1r2c4', source: seActivity('lossesMoreThan5yNotCarried'), kind: 'money', confidence: 'derived', when: isInRepublic },
    // Income arising OUTSIDE the Republic (r4 profit/loss/losses b/f, r5 losses>5y + tax paid).
    { key: 'epr1am4ta1r4c1', source: seActivity('taxableProfit'), kind: 'money', confidence: 'derived', when: isOutside },
    { key: 'epr1am4ta1r4c2', source: seActivity('lossCurrentYear'), kind: 'money', confidence: 'derived', when: isOutside },
    { key: 'epr1am4ta1r4c3', source: seActivity('lossesBfFrom1997'), kind: 'money', confidence: 'derived', when: isOutside },
    { key: 'epr1am4ta1r5c1', source: seActivity('lossesMoreThan5yNotCarried'), kind: 'money', confidence: 'derived', when: isOutside },
    { key: 'epr1am4ta1r5ac1', source: seActivity('taxPaidOutside'), kind: 'money', confidence: 'derived', when: isOutside },
    // Part 4.Α2 — Gain/(loss) on disposal of immovable property or shares.
    // Form layout: r1 = gains (c2 immovable, c3 shares), r2 = losses (c2/c3), r3 = TIC, r4 = country.
    { key: 'epr1am4ta2r1c2', source: 'disposalGainImmovable', kind: 'money', confidence: 'derived' },
    { key: 'epr1am4ta2r1c3', source: 'disposalGainShares', kind: 'money', confidence: 'derived' },
    { key: 'epr1am4ta2r2c2', source: 'disposalLossImmovable', kind: 'money', confidence: 'derived' },
    { key: 'epr1am4ta2r2c3', source: 'disposalLossShares', kind: 'money', confidence: 'derived' },
    { key: 'epr1am4ta2r3c1', source: 'disposalTicOfCompany', kind: 'tic', confidence: 'derived' },
    { key: 'epr1am4ta2r4c1', source: 'disposalCountry', kind: 'text', confidence: 'derived' },
  ],
  grids: [
    {
      // Part 4.Α3 — Income from partnership. Form columns 1-11; portal carries 9
      // (no occupational category / tax-paid-outside). Positional in form order.
      gridId: 'epr1am4ta3r1',
      source: 'partnerships',
      cols: [
        { col: 'c1', field: 'tic', kind: 'tic', confidence: 'derived' },
        { col: 'c1b', field: 'name', kind: 'text', confidence: 'derived' },
        { col: 'c2', field: 'code', kind: 'text', confidence: 'derived' },
        { col: 'c2b', field: 'percentage', kind: 'text', confidence: 'derived' },
        { col: 'c3', field: 'salary', kind: 'money', confidence: 'derived' },
        { col: 'c4', field: 'interestOnCapital', kind: 'money', confidence: 'derived' },
        { col: 'c5', field: 'tradingIncome', kind: 'money', confidence: 'derived' },
        { col: 'c6', field: 'tradingLoss', kind: 'money', confidence: 'derived' },
        { col: 'c7', field: 'taxWithheld', kind: 'money', confidence: 'derived' },
      ],
    },
  ],
};

export const FIELD_MAPS: Record<'epr1m' | 'epr1a', FormMap> = { epr1m: EPR1M, epr1a: EPR1A };
