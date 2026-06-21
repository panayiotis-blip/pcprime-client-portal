// TaxisNet XML export for the Cyprus personal income tax return (Chunk F).
//
// Targets the official Ministry of Finance schema shipped in
// supabase/xsd-tep-ext-2024/. Two forms:
//   epr1m  →  Τ.Φ.1 Μισθωτού        (employee / salaried)      form_type 'individuals'
//   epr1a  →  Τ.Φ.1 Αυτεργοδοτούμενου (self-employed)           form_type 'self_employed'
//
// XML shape — taken from the official sample filings in
// supabase/xsd-tep-ext-2024/.../Samples/ (NOT just the XSD):
//   <mof:epr1m-declarations xmlns:mof="http://www.mof.gov.cy"
//        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
//        xsi:schemaLocation="http://www.mof.gov.cy http://taxisnet.mof.gov.cy/schema/cy-epr1m-declaration.xsd">
//     <mof:epr1m-declaration taxpayer="12345678X" version="2024-1.0">
//       <mof:period from="2024-01-01" to="2024-12-31"/>
//       <mof:field key="epr1mm...">value</mof:field>          (non-table fields)
//       <mof:grid id="epr1mm4tar1">                           (repeating tables)
//         <mof:row number="1"><mof:field key="epr1mm4tar1c1">…</mof:field>…</mof:row>
//       </mof:grid>
//     </mof:epr1m-declaration>
//   </mof:epr1m-declarations>
//
// Field-code grammar:  <form> m<part> t<table> r<row> c<col>   (t0 = not in a table)
//
// Conventions confirmed from the sample filings:
//   - every element carries the `mof:` prefix; root declares mof + xsi + schemaLocation
//   - <period> attributes are ISO (2024-01-01); field DATE values are D/M/YYYY (15/10/1978)
//   - decimal separator is a COMMA, with no zero padding: 543,84 · 28818,4 · -161,61 · 0
//   - computed/total fields are emitted as "0"; genuinely-absent optional columns are omitted
//
// STATUS: skeleton. Envelope + value formatting are final per the samples. The Part 4.A
// employment columns c1–c5 and c8 are sample-confirmed; remaining column/field MAPPINGS are
// PROVISIONAL — confirm against the official "Coding of fields 2024" doc and a TaxisNet import
// before relying on a submission.

const MOF_NS = 'http://www.mof.gov.cy';
const TIC_RE = /^\d{8}[A-Z]$/;

// The bundled XSD/samples are the 2024 form. Newer years need their own schema.
const SUPPORTED_YEARS = [2024];
const VERSION_BY_YEAR: Record<number, string> = { 2024: '2024-1.0' };

export type TaxReturnFormType = 'individuals' | 'self_employed';

export interface TaxisnetBuildResult {
  xml: string;
  warnings: string[];
}

// ---- low-level emit helpers -------------------------------------------------

const xmlEscape = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Money → comma decimal, trailing zeros stripped (11000 · 291,5 · 543,84 · -161,61).
// Blank/non-numeric → '' (skipped); an explicit 0 → "0".
const fmtAmount = (v: unknown): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return s.replace('.', ',');
};

// Date → D/M/YYYY (no zero padding), matching the sample field values.
const fmtDate = (v: unknown): string => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v).trim();
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
};

interface FieldKV { key: string; value: string }
interface GridRow { number: number; fields: FieldKV[] }
interface Grid { id: string; rows: GridRow[] }

const emitField = (key: string, raw: unknown): FieldKV | null => {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  return { key, value };
};

// ---- the column mapping ------------------------------------------------------
// Part 4.A salaried services — grid id epr1mm4tar1.
// c1–c5 and c8 are confirmed against sample-epr1a-2023 a.xml (an epr1m filing).
// c3a/c6/c7/c9 are PROVISIONAL pending the official field-coding document.
type ColKind = 'text' | 'money' | 'date';
const EMPLOYMENT_COLS: { col: string; field: string; kind: ColKind; provisional?: true }[] = [
  { col: 'c1', field: 'employerTic', kind: 'text' },
  { col: 'c2', field: 'employerName', kind: 'text' },
  { col: 'c3', field: 'code', kind: 'text' },
  { col: 'c4', field: 'periodMonths', kind: 'text' },
  { col: 'c5', field: 'grossInRepublic', kind: 'money' },
  { col: 'c6', field: 'grossOutsideRepublic', kind: 'money', provisional: true },
  { col: 'c7', field: 'bik', kind: 'money', provisional: true },
  { col: 'c8', field: 'taxWithheld', kind: 'money' },
  { col: 'c9', field: 'ghsWithheld', kind: 'money', provisional: true },
];

const fmtByKind = (kind: ColKind, raw: unknown): string =>
  kind === 'money' ? fmtAmount(raw) : kind === 'date' ? fmtDate(raw) : String(raw ?? '').trim();

// ---- builder ----------------------------------------------------------------

export function buildTaxisnetXml(
  inputData: any,
  year: number,
  formType: TaxReturnFormType,
): TaxisnetBuildResult {
  const warnings: string[] = [];
  const form = formType === 'self_employed' ? 'epr1a' : 'epr1m';

  if (!SUPPORTED_YEARS.includes(year)) {
    warnings.push(
      `No bundled TaxisNet schema for ${year}. Generated against the ${SUPPORTED_YEARS.join(
        '/',
      )} form — re-check once the ${year} XSD is available.`,
    );
  }
  const version = VERSION_BY_YEAR[year] ?? VERSION_BY_YEAR[2024];

  const tic = String(inputData?.clientTIC ?? '').trim().toUpperCase();
  if (!tic) {
    warnings.push('Taxpayer T.I.C. is missing — TaxisNet will reject the file.');
  } else if (!TIC_RE.test(tic)) {
    warnings.push(`Taxpayer T.I.C. "${tic}" is not in the required format (8 digits + 1 letter).`);
  }

  const fields: FieldKV[] = [];
  const grids: Grid[] = [];

  // Part 1 — taxpayer's T.I.C. is echoed as a field as well as the attribute.
  if (tic) {
    const f = emitField(`${form}m1t0r1c1`, tic);
    if (f) fields.push(f);
  }

  // --- Part 4.A — salaried services (employee form only) ---------------------
  if (form === 'epr1m') {
    const employments: any[] = Array.isArray(inputData?.employments) ? inputData.employments : [];
    const rows: GridRow[] = [];
    employments.forEach((e, i) => {
      const rowFields: FieldKV[] = [];
      for (const c of EMPLOYMENT_COLS) {
        const f = emitField(`epr1mm4tar1${c.col}`, fmtByKind(c.kind, e?.[c.field]));
        if (f) rowFields.push(f);
      }
      if (rowFields.length) rows.push({ number: i + 1, fields: rowFields });
    });
    if (rows.length) {
      grids.push({ id: 'epr1mm4tar1', rows });
      warnings.push(
        'Part 4.A: columns c6/c7/c9 (outside-Republic, BIK, GHS) are provisional — confirm against the official field-coding doc and a TaxisNet import.',
      );
    }
  } else {
    warnings.push('Self-employed (epr1a) field mapping is not built yet — only the envelope is emitted.');
  }

  // --- serialise (mof:-prefixed, matching the official samples) ---------------
  const I = '\t';
  const period = `${I}${I}<mof:period from="${year}-01-01" to="${year}-12-31"/>`;
  const fieldXml = fields.map(
    (f) => `${I}${I}<mof:field key="${f.key}">${xmlEscape(f.value)}</mof:field>`,
  );
  const gridXml = grids.map((g) => {
    const rowXml = g.rows.map((r) => {
      const fs = r.fields.map(
        (f) => `${I}${I}${I}${I}<mof:field key="${f.key}">${xmlEscape(f.value)}</mof:field>`,
      );
      return `${I}${I}${I}<mof:row number="${r.number}">\n${fs.join('\n')}\n${I}${I}${I}</mof:row>`;
    });
    return `${I}${I}<mof:grid id="${g.id}">\n${rowXml.join('\n')}\n${I}${I}</mof:grid>`;
  });

  const body = [period, ...fieldXml, ...gridXml].join('\n');
  const schemaUrl = `http://taxisnet.mof.gov.cy/schema/cy-${form}-declaration.xsd`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mof:${form}-declarations xmlns:mof="${MOF_NS}" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${MOF_NS} ${schemaUrl}">\n` +
    `${I}<mof:${form}-declaration taxpayer="${xmlEscape(tic)}" version="${version}">\n` +
    `${body}\n` +
    `${I}</mof:${form}-declaration>\n` +
    `</mof:${form}-declarations>\n`;

  return { xml, warnings };
}

// Trigger a browser download of the generated XML.
export function downloadTaxisnetXml(
  inputData: any,
  year: number,
  formType: TaxReturnFormType,
): TaxisnetBuildResult {
  const result = buildTaxisnetXml(inputData, year, formType);
  const form = formType === 'self_employed' ? 'epr1a' : 'epr1m';
  const tic = String(inputData?.clientTIC ?? 'taxpayer').trim() || 'taxpayer';
  const blob = new Blob([result.xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${form}-${tic}-${year}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return result;
}
