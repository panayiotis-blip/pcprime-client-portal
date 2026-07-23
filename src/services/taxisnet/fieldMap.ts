// Declarative map: calculator input fields → official TaxisNet field keys.
//
// `source` is a path into the saved tax_returns.input_data (the calculator's
// getInputState() shape). Flat entries map one value to one key; grid entries
// map an array (e.g. employments[]) to repeating <grid> rows, one column key
// per element property.
//
// `confidence`:
//   'confirmed' — the key↔meaning is proven by an official sample filing.
//   'inferred'  — deduced from the TD1 PDF layout / XSD position; must be
//                 confirmed by a real TaxisNet test import. Surfaced as a
//                 warning by the validator so nothing unverified ships silently.
//
// Coverage grows incrementally; every key is checked against keyCatalogue at
// build time, so an out-of-schema key can never reach the file.

import type { FieldKind } from './format';

export type Confidence = 'confirmed' | 'inferred';

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
      // Part 4.A salaried services — confirmed grid id (sample).
      gridId: 'epr1mm4tar1',
      source: 'employments',
      cols: [
        { col: 'c1', field: 'employerTic', kind: 'tic', confidence: 'confirmed' },
        { col: 'c2', field: 'employerName', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'confirmed' },
        { col: 'c4', field: 'periodMonths', kind: 'text', confidence: 'confirmed' },
        { col: 'c5', field: 'grossInRepublic', kind: 'money', confidence: 'confirmed' },
        { col: 'c6', field: 'grossOutsideRepublic', kind: 'money', confidence: 'inferred' },
        { col: 'c7', field: 'bik', kind: 'money', confidence: 'inferred' },
        { col: 'c8', field: 'taxWithheld', kind: 'money', confidence: 'confirmed' },
        { col: 'c9', field: 'ghsWithheld', kind: 'money', confidence: 'inferred' },
      ],
    },
    {
      // Part 4.B pensions — grid tb. Positional: tb has exactly c1–c6 and the
      // pension model has exactly 6 fields, following the TIC/name/code lead
      // pattern proven in 4.A. No sample populated tb, so all inferred.
      gridId: 'epr1mm4tbr1',
      source: 'pensions',
      cols: [
        { col: 'c1', field: 'payerTic', kind: 'tic', confidence: 'inferred' },
        { col: 'c2', field: 'payerName', kind: 'text', confidence: 'inferred' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'inferred' },
        { col: 'c4', field: 'amount', kind: 'money', confidence: 'inferred' },
        { col: 'c5', field: 'taxWithheld', kind: 'money', confidence: 'inferred' },
        { col: 'c6', field: 'ghsWithheld', kind: 'money', confidence: 'inferred' },
      ],
    },
    {
      // Part 4.C rents — grid tc. c12/c13/c15/c16 are anchored to official
      // column numbers the portal model already documents (capital allowances,
      // interest payable, SDC, GHS). Identity/gross cols c1–c8 are positional
      // guesses — the form's full column order isn't confirmed here. All inferred.
      gridId: 'epr1mm4tcr1',
      source: 'rentalProperties',
      cols: [
        { col: 'c1', field: 'registrationNo', kind: 'text', confidence: 'inferred' },
        { col: 'c2', field: 'propertyTypeCode', kind: 'text', confidence: 'inferred' },
        { col: 'c3', field: 'acquisitionDate', kind: 'date', confidence: 'inferred' },
        { col: 'c4', field: 'ownershipShare', kind: 'text', confidence: 'inferred' },
        { col: 'c5', field: 'lesseeTic', kind: 'tic', confidence: 'inferred' },
        { col: 'c6', field: 'lesseeName', kind: 'text', confidence: 'inferred' },
        { col: 'c7', field: 'annualGrossInRepublic', kind: 'money', confidence: 'inferred' },
        { col: 'c8', field: 'annualGrossOutsideRepublic', kind: 'money', confidence: 'inferred' },
        { col: 'c12', field: 'capitalAllowances', kind: 'money', confidence: 'inferred' },
        { col: 'c13', field: 'interestPayable', kind: 'money', confidence: 'inferred' },
        { col: 'c15', field: 'sdcWithheld', kind: 'money', confidence: 'inferred' },
        { col: 'c16', field: 'ghsWithheld', kind: 'money', confidence: 'inferred' },
      ],
    },
    {
      // Part 4.E interest — grid te. c2/c3/c5 are CONFIRMED by the sample filing
      // (payer name / interest code / gross). c1 (debtor TIC, omitted in the
      // sample because the payers were foreign) and the withholding cols are
      // inferred. `country` is intentionally NOT mapped — the sample uses a
      // coded country format (e.g. OECD605) we don't capture as free text.
      gridId: 'epr1mm4ter1',
      source: 'interestSources',
      cols: [
        { col: 'c1', field: 'debtorTic', kind: 'tic', confidence: 'inferred' },
        { col: 'c2', field: 'debtorName', kind: 'text', confidence: 'confirmed' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'confirmed' },
        { col: 'c5', field: 'grossInterest', kind: 'money', confidence: 'confirmed' },
        { col: 'c6', field: 'sdcWithheld', kind: 'money', confidence: 'inferred' },
        { col: 'c7', field: 'taxPaidOutside', kind: 'money', confidence: 'inferred' },
        { col: 'c7a', field: 'ghsWithheld', kind: 'money', confidence: 'inferred' },
        // c11 = security / account identifier (e.g. VUTY, an IBKR account, an
        // ISIN). Confirmed by the real epr1m sample; maps to the portal's
        // `accountType` free-text field. c10 (country) is a coded value
        // (OECD605) so it stays unmapped until we capture the coded form.
        { col: 'c11', field: 'accountType', kind: 'text', confidence: 'confirmed' },
      ],
    },
    {
      // Part 4.F dividends — grid tz (position F, after the portal-skipped D).
      // No epr1m sample populated tz, so all inferred. `country` not mapped
      // (coded format, as with interest).
      gridId: 'epr1mm4tzr1',
      source: 'dividendSources',
      cols: [
        { col: 'c1', field: 'payerTic', kind: 'tic', confidence: 'inferred' },
        { col: 'c2', field: 'businessName', kind: 'text', confidence: 'inferred' },
        { col: 'c3', field: 'code', kind: 'text', confidence: 'inferred' },
        { col: 'c4', field: 'grossDividend', kind: 'money', confidence: 'inferred' },
        { col: 'c5', field: 'sdcWithheld', kind: 'money', confidence: 'inferred' },
        { col: 'c5a', field: 'ghsWithheld', kind: 'money', confidence: 'inferred' },
        { col: 'c6', field: 'taxPaidOutside', kind: 'money', confidence: 'inferred' },
        { col: 'c7', field: 'receiptDate', kind: 'date', confidence: 'inferred' },
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
// Self-employed schedules from the official TD1A form layout (Part 4 Α1/Α2/Α3).
// The sample filing doesn't populate these, so column meanings come from the
// form's printed structure — all inferred, confirm via a TaxisNet import.
const seActivity = (field: string) => `selfEmployedActivities.0.${field}`;
const isOutside = (input: any) => !!input?.selfEmployedActivities?.[0]?.isOutsideRepublic;
const isInRepublic = (input: any) => !isOutside(input);

const EPR1A: FormMap = {
  ticSource: 'clientTIC',
  ticFieldKey: 'epr1am1t0r1c1', // Part 1 taxpayer T.I.C. — confirmed (sample)
  flat: [
    // Part 4.Α1 — Trade / industry / profession (single activity).
    { key: 'epr1am4ta1r1c1', source: seActivity('mainCategory'), kind: 'text', confidence: 'inferred' },
    { key: 'epr1am4ta1r1ac1', source: seActivity('occupationalCategory'), kind: 'text', confidence: 'inferred' },
    // Income arising IN the Republic (r2: profit / loss / losses b/f 1997 / losses >5y).
    { key: 'epr1am4ta1r2c1', source: seActivity('taxableProfit'), kind: 'money', confidence: 'inferred', when: isInRepublic },
    { key: 'epr1am4ta1r2c2', source: seActivity('lossCurrentYear'), kind: 'money', confidence: 'inferred', when: isInRepublic },
    { key: 'epr1am4ta1r2c3', source: seActivity('lossesBfFrom1997'), kind: 'money', confidence: 'inferred', when: isInRepublic },
    { key: 'epr1am4ta1r2c4', source: seActivity('lossesMoreThan5yNotCarried'), kind: 'money', confidence: 'inferred', when: isInRepublic },
    // Income arising OUTSIDE the Republic (r4 profit/loss/losses b/f, r5 losses>5y + tax paid).
    { key: 'epr1am4ta1r4c1', source: seActivity('taxableProfit'), kind: 'money', confidence: 'inferred', when: isOutside },
    { key: 'epr1am4ta1r4c2', source: seActivity('lossCurrentYear'), kind: 'money', confidence: 'inferred', when: isOutside },
    { key: 'epr1am4ta1r4c3', source: seActivity('lossesBfFrom1997'), kind: 'money', confidence: 'inferred', when: isOutside },
    { key: 'epr1am4ta1r5c1', source: seActivity('lossesMoreThan5yNotCarried'), kind: 'money', confidence: 'inferred', when: isOutside },
    { key: 'epr1am4ta1r5ac1', source: seActivity('taxPaidOutside'), kind: 'money', confidence: 'inferred', when: isOutside },
    // Part 4.Α2 — Gain/(loss) on disposal of immovable property or shares.
    // Form layout: r1 = gains (c2 immovable, c3 shares), r2 = losses (c2/c3), r3 = TIC, r4 = country.
    { key: 'epr1am4ta2r1c2', source: 'disposalGainImmovable', kind: 'money', confidence: 'inferred' },
    { key: 'epr1am4ta2r1c3', source: 'disposalGainShares', kind: 'money', confidence: 'inferred' },
    { key: 'epr1am4ta2r2c2', source: 'disposalLossImmovable', kind: 'money', confidence: 'inferred' },
    { key: 'epr1am4ta2r2c3', source: 'disposalLossShares', kind: 'money', confidence: 'inferred' },
    { key: 'epr1am4ta2r3c1', source: 'disposalTicOfCompany', kind: 'tic', confidence: 'inferred' },
    { key: 'epr1am4ta2r4c1', source: 'disposalCountry', kind: 'text', confidence: 'inferred' },
  ],
  grids: [
    {
      // Part 4.Α3 — Income from partnership. Form columns 1-11; portal carries 9
      // (no occupational category / tax-paid-outside). Positional in form order.
      gridId: 'epr1am4ta3r1',
      source: 'partnerships',
      cols: [
        { col: 'c1', field: 'tic', kind: 'tic', confidence: 'inferred' },
        { col: 'c1b', field: 'name', kind: 'text', confidence: 'inferred' },
        { col: 'c2', field: 'code', kind: 'text', confidence: 'inferred' },
        { col: 'c2b', field: 'percentage', kind: 'text', confidence: 'inferred' },
        { col: 'c3', field: 'salary', kind: 'money', confidence: 'inferred' },
        { col: 'c4', field: 'interestOnCapital', kind: 'money', confidence: 'inferred' },
        { col: 'c5', field: 'tradingIncome', kind: 'money', confidence: 'inferred' },
        { col: 'c6', field: 'tradingLoss', kind: 'money', confidence: 'inferred' },
        { col: 'c7', field: 'taxWithheld', kind: 'money', confidence: 'inferred' },
      ],
    },
  ],
};

export const FIELD_MAPS: Record<'epr1m' | 'epr1a', FormMap> = { epr1m: EPR1M, epr1a: EPR1A };
