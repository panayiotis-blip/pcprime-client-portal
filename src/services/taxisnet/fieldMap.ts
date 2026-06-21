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
