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
  ],
};

// ---- epr1a — TD1A self-employed --------------------------------------------
const EPR1A: FormMap = {
  ticSource: 'clientTIC',
  ticFieldKey: 'epr1am1t0r1c1', // Part 1 taxpayer T.I.C. — confirmed (sample)
  flat: [],
  grids: [],
};

export const FIELD_MAPS: Record<'epr1m' | 'epr1a', FormMap> = { epr1m: EPR1M, epr1a: EPR1A };
