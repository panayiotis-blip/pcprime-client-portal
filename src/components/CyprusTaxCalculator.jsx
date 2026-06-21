import React, { useState, useMemo, useCallback, useRef, useContext, createContext } from 'react';
import { jsPDF } from 'jspdf';
// Roboto-Regular ships Greek glyphs (jsPDF's default Helvetica is Latin-only).
// Each PDF generator calls registerRobotoFont(doc) immediately after new jsPDF()
// before any setFont('Roboto', ...) calls. Regenerate via `npm run build:fonts`.
import { registerRobotoFont } from '../assets/fonts/Roboto-Regular-normal.js';
import { downloadTaxisnetXml } from '../services/taxisnetXml';
import { Calculator, FileText, ChevronDown, ChevronUp, Info, Briefcase, Users, Coins, GitCompare, Download, Printer, User, FileDown, FileSpreadsheet, FileCode, Mail, Eye, EyeOff } from 'lucide-react';

// ============ TAX YEAR CONSTANTS ============
const TAX_YEARS = {
  2024: {
    label: '2024',
    description: 'For 2024 tax returns (filed by 31 July 2025)',
    bands: [
      { min: 0, max: 19500, rate: 0 },
      { min: 19500, max: 28000, rate: 0.20 },
      { min: 28000, max: 36300, rate: 0.25 },
      { min: 36300, max: 60000, rate: 0.30 },
      { min: 60000, max: Infinity, rate: 0.35 },
    ],
    // Per user: 2024 uses the same calculations as 2025. Verify siCap/ghsCap if a client's
    // 2024 income is near the cap — adjust this entry if the actual 2024 figures differ.
    siCap: 66612,
    ghsCap: 180000,
    siRates: { employee: 0.088, employer: 0.088, redundancy: 0.012, hrda: 0.005, socialCohesion: 0.02, selfEmployed: 0.166 },
    ghsRates: { employee: 0.0265, employer: 0.029, selfEmployed: 0.04, passive: 0.0265 },
    sdcRates: { dividends: 0.17, interest: 0.17, rental: 0.0225 },
    flatRates: { crypto: 0.08, stockOptions: 0.08, severance: 0.20, foreignPension: 0.05 },
    severanceExempt: 200000,
    foreignPensionThreshold: 5000,
    foreignReliefThreshold: 55000,
    foreignReliefDuration: 17,
    foreignRelief20Cap: 8550,
    lossCarryForward: 5,
    newAllowances: false,
    familyThresholds: null,
    notes: 'Pre-reform rates (same structure as 2025). SDC on dividends at 17%.',
  },
  2025: {
    label: '2025',
    description: 'For 2025 tax returns (filed by 31 July 2026)',
    bands: [
      { min: 0, max: 19500, rate: 0 },
      { min: 19500, max: 28000, rate: 0.20 },
      { min: 28000, max: 36300, rate: 0.25 },
      { min: 36300, max: 60000, rate: 0.30 },
      { min: 60000, max: Infinity, rate: 0.35 },
    ],
    siCap: 66612,
    ghsCap: 180000,
    siRates: { employee: 0.088, employer: 0.088, redundancy: 0.012, hrda: 0.005, socialCohesion: 0.02, selfEmployed: 0.166 },
    ghsRates: { employee: 0.0265, employer: 0.029, selfEmployed: 0.04, passive: 0.0265 },
    sdcRates: { dividends: 0.17, interest: 0.17, rental: 0.0225 },
    flatRates: { crypto: 0.08, stockOptions: 0.08, severance: 0.20, foreignPension: 0.05 },
    severanceExempt: 200000,
    foreignPensionThreshold: 5000,
    foreignReliefThreshold: 55000,
    foreignReliefDuration: 17,
    foreignRelief20Cap: 8550,
    lossCarryForward: 5,
    newAllowances: false,
    familyThresholds: null,
    notes: 'Pre-reform rates. SDC on dividends at 17%. No family/housing/green allowances.',
  },
  2026: {
    label: '2026',
    description: 'New tax reform (effective 1 January 2026)',
    bands: [
      { min: 0, max: 22000, rate: 0 },
      { min: 22000, max: 32000, rate: 0.20 },
      { min: 32000, max: 42000, rate: 0.25 },
      { min: 42000, max: 72000, rate: 0.30 },
      { min: 72000, max: Infinity, rate: 0.35 },
    ],
    siCap: 68904,
    ghsCap: 180000,
    siRates: { employee: 0.088, employer: 0.088, redundancy: 0.012, hrda: 0.005, socialCohesion: 0.02, selfEmployed: 0.166 },
    ghsRates: { employee: 0.0265, employer: 0.029, selfEmployed: 0.04, passive: 0.0265 },
    sdcRates: { dividends: 0.05, interest: 0.17, rental: 0 },
    flatRates: { crypto: 0.08, stockOptions: 0.08, severance: 0.20, foreignPension: 0.05 },
    severanceExempt: 200000,
    foreignPensionThreshold: 5000,
    foreignReliefThreshold: 55000,
    foreignReliefDuration: 10,
    foreignRelief20Cap: 8550,
    lossCarryForward: 7,
    newAllowances: true,
    familyThresholds: { 0: 90000, '1-2': 100000, '3-4': 150000, '5+': 200000 },
    childAmounts: [1000, 1250, 1500],
    housingMax: 2000,
    greenMax: 1000,
    homeInsuranceMax: 500,
    notes: 'Tax reform: higher tax-free threshold, new family allowances, reduced SDC on dividends.',
  },
};

const COLORS = {
  bg: '#fafbfc', card: '#ffffff', cardLight: '#f8fafc', border: '#e2e8f0', borderLight: '#eef2f7',
  frame: '#1a365d',
  accent: '#9b861f', accentDim: '#7d6c19', text: '#000814', textMuted: '#1e293b', textDim: '#334155',
  success: '#15803d', danger: '#b91c1c', year2025: '#334155', year2026: '#9b861f',
};

// Embedded-mode context — true when the calculator is rendered inside the
// portal Tax Filings tab. Section uses this to render TD1-style navy header
// bars; public /tax keeps the original gold-text-on-white look.
const EmbeddedContext = createContext(false);

// ============ TD1 TABLE STYLES (used by G3 multi-column row-array tables) ============
const TD1 = {
  table:    { width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', marginBottom: '0.5rem', tableLayout: 'auto' },
  thRow:    { background: '#9b861f', color: '#ffffff' },
  th:       { padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', borderRight: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap' },
  thNum:    { padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', borderRight: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap' },
  td:       { padding: '0.2rem 0.25rem', borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #f1f5f9', verticalAlign: 'middle', background: '#ffffff' },
  input:    { width: '100%', padding: '0.35rem 0.4rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '2px', fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box' },
  inputN:   { width: '100%', padding: '0.35rem 0.4rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '2px', fontSize: '0.78rem', fontFamily: 'inherit', boxSizing: 'border-box', textAlign: 'right' },
  select:   { width: '100%', padding: '0.3rem 0.35rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '2px', fontSize: '0.74rem', fontFamily: 'inherit', boxSizing: 'border-box' },
  removeBtn:{ padding: '0.15rem 0.4rem', background: 'transparent', color: '#b91c1c', border: '1px solid #b91c1c', borderRadius: '3px', cursor: 'pointer', fontSize: '0.68rem', fontFamily: 'inherit', lineHeight: 1 },
  addBtn:   { width: '100%', padding: '0.45rem', background: '#ffffff', color: '#9b861f', border: '1px dashed #9b861f', borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.85rem' },
  wrap:     { overflowX: 'auto', marginBottom: '0.4rem' },
  caption:  { fontSize: '0.72rem', color: '#334155', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '0.6rem', marginBottom: '0.4rem' },
  captionItalic: { textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: '#64748b', fontWeight: 400 },
  // Code legend — small strip above the table listing every available code
  // and what it means. Mirrors the inline legend on the official TD1 form.
  legend:   { background: '#fffbeb', border: '1px solid #f5e8b8', padding: '0.4rem 0.6rem', fontSize: '0.7rem', color: '#5a6478', marginBottom: '0.4rem', lineHeight: 1.6, borderRadius: '2px' },
  legendItem: { marginRight: '0.9rem', whiteSpace: 'nowrap', display: 'inline-block' },
  legendBadge: { display: 'inline-block', padding: '0 5px', borderRadius: '2px', background: '#9b861f', color: '#fff', fontWeight: 700, marginRight: '4px', fontSize: '0.68rem' },
  // Footer TOTAL row — navy band sitting under the table summing numeric cols.
  tfootRow:   { background: '#1a365d', color: '#ffffff' },
  tfootLabel: { padding: '0.35rem 0.5rem', textAlign: 'left', fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', borderRight: '1px solid rgba(255,255,255,0.2)' },
  tfootCell:  { padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.78rem', borderRight: '1px solid rgba(255,255,255,0.2)', fontVariantNumeric: 'tabular-nums' },
};

// Strip "Code N — " prefix from a label so the legend doesn't repeat the code badge.
const shortCodeLabel = (label) => String(label || '').replace(/^Code\s*\d+(?:\s*[—-]\s*)?/i, '');
// Format a column sum for the TOTAL row; shows blank instead of 0.00 when there's nothing to total.
const fmtSum = (n) => {
  const v = Number(n) || 0;
  return v === 0 ? '' : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Firm logo (PC Prime & Calculate Consultants Ltd) - embedded as base64 for self-contained PDF
const FIRM_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAACzQAAAQCCAIAAABPV8tbAAAABmJLR0QA/wD/AP+gvaeTAAAgAElEQVR4nOzdV5MjR57m6797BFTKKqqe3p4esbb3x87d+f5f5Nj09k43yRJZqQAEEO57AZFIUVWsbkbJ5zEYCCAlSJBJs/zV66nWGgAAAAAAAAAADCN/6m8AAAAAAAAAAOBrJs4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAAAAAAAACAAYkzAAAAAAAAAAAGJM4AAAAAAAAAABiQOAMAAAAAAAAAYEDiDAAA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";

const fmt = (val) => {
  if (val === undefined || val === null || isNaN(val) || val === 0) return '€0.00';
  return new Intl.NumberFormat('en-EU', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
};

const fmtNoEuro = (val) => {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return new Intl.NumberFormat('en-EU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
};

// ============ STABLE SUB-COMPONENTS ============
// ============ EMPLOYMENT ROW HELPERS (TD1 Part 4.A) ============
// One row per employer; codes match the official TD1 form Part 4.A column 3.
const EMPLOYMENT_CODES = [
  { code: '1',  label: 'Code 1 — In Republic (standard)' },
  { code: '2',  label: 'Code 2 — Outside Republic (salary/benefits)' },
  { code: '3',  label: 'Code 3 — In Republic, prior non-resident (sect. 8(21))' },
  { code: '4',  label: 'Code 4 — Outside, non-resident employer > 90 days' },
  { code: '5',  label: 'Code 5 — Unemployed' },
  { code: '6',  label: 'Code 6 — In Republic, prior non-resident > €100k (sect. 8(23))' },
  { code: '7',  label: 'Code 7 — Debit-balance benefit (article 5(1)(g))' },
  { code: '8',  label: 'Code 8 — AIF carried interest / UCITS (sect. 20B/20C)' },
  { code: '9',  label: 'Code 9 — Benefits not subject to SI' },
  { code: '12', label: 'Code 12 — First employment from 1.1.2022 (10y outside)' },
  { code: '13', label: 'Code 13 — First employment from 1.1.2022 (15y outside)' },
  { code: '14', label: 'Code 14 — First employment after 26.7.2022 (3y outside)' },
];

const newEmploymentId = () => `emp-${Math.random().toString(36).slice(2, 11)}`;

const emptyEmployment = () => ({
  id: newEmploymentId(),
  employerName: '',
  employerTic: '',
  code: '1',
  periodMonths: 12,
  grossInRepublic: '',
  grossOutsideRepublic: '',
  taxWithheld: '',
  ghsWithheld: '',
  bik: '',
  commencementDate: '',
  terminationDate: '',
});

// Build the employments[] array from saved input_data.
// Handles three cases: (1) already-array, (2) legacy single-field shape from
// pre-B1 saves, (3) brand-new (no input_data) → one empty row.
const initEmployments = (initialState) => {
  if (initialState?.employments && Array.isArray(initialState.employments) && initialState.employments.length > 0) {
    return initialState.employments.map(e => ({ ...emptyEmployment(), ...e, id: e.id || newEmploymentId() }));
  }
  const hasLegacy = initialState && (initialState.employmentIncome || initialState.bik);
  if (hasLegacy) {
    return [{
      ...emptyEmployment(),
      grossInRepublic: String(initialState.employmentIncome || ''),
      bik: String(initialState.bik || ''),
    }];
  }
  return [emptyEmployment()];
};

// ============ PENSION ROW HELPERS (TD1 Part 4.B) ============
// Code → tax treatment:
//   1, 4, 5: Cyprus pensions taxed at normal progressive rates
//   8       : Overseas pension taxed at normal progressive rates
//   2       : Overseas pension elected at 5% flat over €5,000 (Y.foreignPensionThreshold)
//   6       : Widow's pension elected at 20% flat over €19,500 (per TD1 note 5)
//   3       : Exempted (excluded from taxable income)
const PENSION_CODES = [
  { code: '1', label: 'Code 1 — Normal rates from the Republic',                       taxation: 'progressive' },
  { code: '2', label: 'Code 2 — Overseas, special rate (5% over €5,000)',              taxation: 'foreignFlat'  },
  { code: '3', label: 'Code 3 — Exempted',                                              taxation: 'exempt'       },
  { code: '4', label: 'Code 4 — Social Insurance (SIS) — Normal rates',                taxation: 'progressive' },
  { code: '5', label: 'Code 5 — Non-resident from employment in the Republic',         taxation: 'progressive' },
  { code: '6', label: "Code 6 — Widow's, special rate (20% over €19,500)",              taxation: 'widowFlat'    },
  { code: '8', label: 'Code 8 — Overseas, normal rates',                                taxation: 'progressive' },
];
const PENSION_CODE_TAXATION = Object.fromEntries(PENSION_CODES.map(c => [c.code, c.taxation]));

const newPensionId = () => `pen-${Math.random().toString(36).slice(2, 11)}`;

const emptyPension = () => ({
  id: newPensionId(),
  payerTic: '',
  payerName: '',
  code: '1',
  amount: '',
  taxWithheld: '',
  ghsWithheld: '',
});

// ============ RENTAL PROPERTY HELPERS (TD1 Part 4.C) ============
// Property type code controls the SDC rate per the official form. For B2 we
// capture the code but the calculation continues to use the flat sdcRates.rental
// from TAX_YEARS — per-type SDC rates can be applied in a later chunk.
const PROPERTY_TYPES = [
  { code: '1',  label: 'Code 1 — Office (3% SDC)' },
  { code: '2',  label: 'Code 2 — Shop (3% SDC)' },
  { code: '3',  label: 'Code 3 — Flat (3% SDC)' },
  { code: '4',  label: 'Code 4 — House (3% SDC)' },
  { code: '5',  label: 'Code 5 — Storehouse (4% SDC)' },
  { code: '6',  label: 'Code 6 — Land (0% SDC)' },
  { code: '7',  label: 'Code 7 — Parking space (0% SDC)' },
  { code: '8',  label: 'Code 8 — Factory / Hotel (4%/7% SDC)' },
  { code: '9',  label: 'Code 9 — Other property (0% SDC)' },
  { code: '10', label: 'Code 10 — Building with 10% allowance (3% SDC)' },
  { code: '11', label: 'Code 11 — Under requisition order (0% SDC, not subject)' },
];

const newRentalPropertyId = () => `prop-${Math.random().toString(36).slice(2, 11)}`;

const emptyRentalProperty = () => ({
  id: newRentalPropertyId(),
  registrationNo: '',
  propertyTypeCode: '3', // default Flat
  acquisitionDate: '',
  ownershipShare: '100',
  lesseeTic: '',
  lesseeName: '',
  annualGrossInRepublic: '',
  annualGrossOutsideRepublic: '',
  capitalAllowances: '', // TD1 Part 4.C col 12
  interestPayable: '',    // TD1 Part 4.C col 13
  sdcWithheld: '',        // TD1 Part 4.C col 15
  ghsWithheld: '',        // TD1 Part 4.C col 16
});

// Migrate legacy single-rental fields (rentalIncome / rentalInterest / rentalMaintenance) into rows.
const initRentalProperties = (initialState) => {
  if (initialState?.rentalProperties && Array.isArray(initialState.rentalProperties) && initialState.rentalProperties.length > 0) {
    return initialState.rentalProperties.map(r => ({ ...emptyRentalProperty(), ...r, id: r.id || newRentalPropertyId() }));
  }
  const legacy = initialState || {};
  if (legacy.rentalIncome || legacy.rentalInterest || legacy.rentalMaintenance) {
    return [{
      ...emptyRentalProperty(),
      annualGrossInRepublic: String(legacy.rentalIncome || ''),
      interestPayable: String(legacy.rentalInterest || ''),
      // Legacy `rentalMaintenance` was treated as an additional deduction; TD1 puts
      // depreciation in "capital allowances for rented property" (col 12). Same math.
      capitalAllowances: String(legacy.rentalMaintenance || ''),
    }];
  }
  return []; // rentals are optional
};

// ============ PART 5.C — LIFE / SI / PENSION FUND DEDUCTIONS (portal-only) ============
// Codes per the TD1 form. Code 2 (SIS) is informational only in our calc — SI is already
// auto-computed from income. The other codes feed into the existing per-code allowed
// deductions (pension 10%, life 7% of sum assured per policy, medical 1.5%/2%).
const LIFE_SI_PENSION_CODES = [
  { code: '1', label: 'Code 1 — Approved funds & pension plans (10% cap)' },
  { code: '2', label: 'Code 2 — Social Insurance Fund (SIS — auto-computed, info only)' },
  { code: '3', label: 'Code 3 — Life insurance policies (7% of sum assured)' },
  { code: '4', label: 'Code 4 — Medical funds / private medical insurance' },
  { code: '5', label: 'Code 5 — Widows pension fund' },
  { code: '6', label: 'Code 6 — Overseas social insurance fund' },
];

const newLifeSiPensionFundId = () => `lsp-${Math.random().toString(36).slice(2, 11)}`;

const emptyLifeSiPensionFund = () => ({
  id: newLifeSiPensionFundId(),
  code: '1',
  fundName: '',
  fundTic: '',
  policyDate: '',
  lifeOf: 'own',   // 'own' | 'spouse' (only relevant for code 3)
  sumAssured: '',  // only relevant for code 3
  amountPaid: '',
});

const initLifeSiPensionFunds = (initialState) => {
  if (initialState?.lifeSiPensionFunds && Array.isArray(initialState.lifeSiPensionFunds) && initialState.lifeSiPensionFunds.length > 0) {
    return initialState.lifeSiPensionFunds.map(r => ({ ...emptyLifeSiPensionFund(), ...r, id: r.id || newLifeSiPensionFundId() }));
  }
  // Legacy migration: each existing single-field that's non-empty becomes one row.
  const legacy = initialState || {};
  const rows = [];
  if (legacy.pensionContrib) {
    rows.push({ ...emptyLifeSiPensionFund(), code: '1', fundName: '(Legacy pension)', amountPaid: String(legacy.pensionContrib) });
  }
  if (legacy.lifeInsurance) {
    rows.push({ ...emptyLifeSiPensionFund(), code: '3', fundName: '(Legacy life policy)', amountPaid: String(legacy.lifeInsurance), sumAssured: String(legacy.lifeSumAssured || '') });
  }
  if (legacy.medicalContrib) {
    rows.push({ ...emptyLifeSiPensionFund(), code: '4', fundName: '(Legacy medical)', amountPaid: String(legacy.medicalContrib) });
  }
  return rows;
};

// ============ PART 5.B — INVESTMENT IN INNOVATIVE BUSINESSES (portal-only) ============
const INNOVATIVE_INVESTMENT_CODES = [
  { code: '1', label: 'Code 1 — From 2017 directly (≤5.12.2023), fund, or alt. trading platform' },
  { code: '2', label: 'Code 2 — From 6.12.2023, direct in new SME (no prior activity)' },
  { code: '3', label: 'Code 3 — From 6.12.2023, SME ≤10y old or ≤7y from first commercial sale' },
  { code: '4', label: 'Code 4 — Natural person investment > 50% of last-5y turnover' },
];

const newInnovativeInvestmentId = () => `inv-${Math.random().toString(36).slice(2, 11)}`;

const emptyInnovativeInvestment = () => ({
  id: newInnovativeInvestmentId(),
  tic: '',
  yearOfInvestment: '',
  yearOfContinuationInvestment: '',
  code: '1',
  initialAmount: '',
  amountClaimedUpTo2023: '',
  amountToClaim: '',
});

const initInnovativeInvestments = (initialState) => {
  if (initialState?.innovativeInvestments && Array.isArray(initialState.innovativeInvestments)) {
    return initialState.innovativeInvestments.map(r => ({ ...emptyInnovativeInvestment(), ...r, id: r.id || newInnovativeInvestmentId() }));
  }
  return [];
};

// ============ SELF-EMPLOYED: Part 4.1 Trade/Industry/Profession activities ============
// Main activity categories per the TD1 self-employed form.
const SELF_EMP_ACTIVITY_TYPES = [
  { code: '1', label: '1. Trade' },
  { code: '2', label: '2. Industry' },
  { code: '3', label: '3. Agriculture / Fishing' },
  { code: '4', label: '4. Profession' },
  { code: '5', label: '5. Vocation' },
  { code: '6', label: '6. Equestrian / OPAP betting' },
];
// Occupational categories drive the GHS rate: 1-16 → 4%, N/A → 2.65%.
const SELF_EMP_OCCUPATIONAL_OPTIONS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','NA'];

const newSelfEmpActivityId = () => `sea-${Math.random().toString(36).slice(2, 11)}`;
const emptySelfEmpActivity = () => ({
  id: newSelfEmpActivityId(),
  mainCategory: '1',
  occupationalCategory: '1',
  isOutsideRepublic: false,
  taxableProfit: '',
  lossCurrentYear: '',
  lossesBfFrom1997: '',
  lossesMoreThan5yNotCarried: '',
  taxPaidOutside: '',
});
const initSelfEmployedActivities = (initialState) => {
  // Per user direction: a self-employed return has exactly ONE trade activity row.
  // If saved data has multiple rows (e.g. from an earlier dev state), keep only the first.
  if (initialState?.selfEmployedActivities && Array.isArray(initialState.selfEmployedActivities) && initialState.selfEmployedActivities.length > 0) {
    const first = initialState.selfEmployedActivities[0];
    return [{ ...emptySelfEmpActivity(), ...first, id: first.id || newSelfEmpActivityId() }];
  }
  // Legacy migration: if a single selfEmpIncome existed, seed it as the trade row.
  if (initialState?.selfEmpIncome) {
    return [{ ...emptySelfEmpActivity(), taxableProfit: String(initialState.selfEmpIncome) }];
  }
  return [emptySelfEmpActivity()]; // always start with one row
};

// ============ SELF-EMPLOYED: Part 4.3 Partnership income ============
const newPartnershipId = () => `prt-${Math.random().toString(36).slice(2, 11)}`;
const emptyPartnership = () => ({
  id: newPartnershipId(),
  tic: '',
  name: '',
  code: '1', // 1 = in Republic, 2 = outside
  occupationalCategory: '1',
  percentage: '',
  salary: '',
  interestOnCapital: '',
  tradingIncome: '',
  tradingLoss: '',
  taxWithheld: '',
  taxPaidOutside: '',
});
const initPartnerships = (initialState) => {
  if (initialState?.partnerships && Array.isArray(initialState.partnerships)) {
    return initialState.partnerships.map(p => ({ ...emptyPartnership(), ...p, id: p.id || newPartnershipId() }));
  }
  return [];
};

// ============ LIFE INSURANCE REDEMPTION (TD1 Part 4.G) — portal-only ============
// Per TD1 Notes for Tax Computation, note 1:
//   • Cancellation within 3 years of issue → 30% of total premiums deducted is added back to income
//   • Cancellation between 3 and 6 years   → 20% added back
//   • Cancellation after 6 years           → 0% (no add-back)
const newLifeRedemptionId = () => `lr-${Math.random().toString(36).slice(2, 11)}`;

const emptyLifeRedemption = () => ({
  id: newLifeRedemptionId(),
  insuranceCompanyTic: '',
  insuranceCompanyName: '',
  issueDate: '',
  cancellationDate: '',
  premiumsDeducted: '',
});

const initLifeRedemptions = (initialState) => {
  if (initialState?.lifeRedemptions && Array.isArray(initialState.lifeRedemptions)) {
    return initialState.lifeRedemptions.map(r => ({ ...emptyLifeRedemption(), ...r, id: r.id || newLifeRedemptionId() }));
  }
  return [];
};

// ============ INTEREST SOURCE HELPERS (TD1 Part 4.E) — portal-only ============
// Codes match the TD1 form. SDC withholding behaviour varies by code (3% for code 2,
// 17% for codes 3/4, none for codes 1/5).
const INTEREST_CODES = [
  { code: '1', label: 'Code 1 — Loans / other sources (no SDC at source)' },
  { code: '2', label: 'Code 2 — Securities / bonds of Government & listed corps (3% SDC)' },
  { code: '3', label: 'Code 3 — Bank deposits / debentures of companies (17% SDC at source)' },
  { code: '4', label: 'Code 4 — Other bonds (17% SDC at source)' },
  { code: '5', label: 'Code 5 — Sources outside the Republic' },
];

const newInterestSourceId = () => `int-${Math.random().toString(36).slice(2, 11)}`;

const emptyInterestSource = () => ({
  id: newInterestSourceId(),
  code: '3',
  debtorTic: '',
  debtorName: '',
  grossInterest: '',
  taxPaidOutside: '',
  sdcWithheld: '',
  ghsWithheld: '',
  country: '',
  accountType: '',
});

const initInterestSources = (initialState) => {
  if (initialState?.interestSources && Array.isArray(initialState.interestSources) && initialState.interestSources.length > 0) {
    return initialState.interestSources.map(s => ({ ...emptyInterestSource(), ...s, id: s.id || newInterestSourceId() }));
  }
  // Legacy single interestIncome field → one row with code 3 (bank deposits is most common)
  if (initialState?.interestIncome) {
    return [{ ...emptyInterestSource(), grossInterest: String(initialState.interestIncome), debtorName: '(Bank — legacy)' }];
  }
  return [];
};

// ============ DIVIDEND SOURCE HELPERS (TD1 Part 4.F) — portal-only ============
const DIVIDEND_CODES = [
  { code: '1', label: 'Code 1 — From companies in the Republic' },
  { code: '2', label: 'Code 2 — From companies outside the Republic' },
  { code: '3', label: 'Code 3 — From qualifying ships (Merchant Shipping Law, exempt)' },
  { code: '4', label: 'Code 4 — Deemed dividends from 2022 profits (Republic companies)' },
];

const newDividendSourceId = () => `div-${Math.random().toString(36).slice(2, 11)}`;

const emptyDividendSource = () => ({
  id: newDividendSourceId(),
  code: '1',
  payerTic: '',
  country: '',
  businessName: '',
  grossDividend: '',
  sdcWithheld: '',
  ghsWithheld: '',
  taxPaidOutside: '',
  receiptDate: '',
});

const initDividendSources = (initialState) => {
  if (initialState?.dividendSources && Array.isArray(initialState.dividendSources) && initialState.dividendSources.length > 0) {
    return initialState.dividendSources.map(s => ({ ...emptyDividendSource(), ...s, id: s.id || newDividendSourceId() }));
  }
  if (initialState?.dividendIncome) {
    return [{ ...emptyDividendSource(), grossDividend: String(initialState.dividendIncome), businessName: '(Legacy dividend)' }];
  }
  return [];
};

// Migrate legacy single-pension fields (foreignPension* + cyprusPension*) into rows.
const initPensions = (initialState) => {
  if (initialState?.pensions && Array.isArray(initialState.pensions) && initialState.pensions.length > 0) {
    return initialState.pensions.map(p => ({ ...emptyPension(), ...p, id: p.id || newPensionId() }));
  }
  const legacy = initialState || {};
  const migrated = [];
  if (legacy.foreignPensionIncome) {
    migrated.push({
      ...emptyPension(),
      amount: String(legacy.foreignPensionIncome),
      // Election=true meant 5% flat → code 2; false meant progressive → code 8
      code: legacy.foreignPensionElectFlat === false ? '8' : '2',
      payerName: '(Foreign pension)',
    });
  }
  if (legacy.cyprusPensionIncome) {
    migrated.push({
      ...emptyPension(),
      amount: String(legacy.cyprusPensionIncome),
      // Election=true meant the widow's special rate → code 6 (now 20%/€19,500 per TD1,
      // was 5%/€3,420 in legacy code — bug fix)
      code: legacy.cyprusPensionElectFlat ? '6' : '1',
      payerName: '(Cyprus pension)',
    });
  }
  return migrated; // pensions are optional — empty array is fine
};

const InputRow = React.memo(({ label, hint, value, onChange, type = 'number', placeholder = '0.00', readOnly = false }) => (
  <div style={{ marginBottom: '0.7rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
      <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600 }}>{label}</label>
      {hint && <span style={{ fontSize: '0.66rem', color: COLORS.textDim, fontStyle: 'italic' }}>{hint}</span>}
    </div>
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly}
      style={{ width: '100%', padding: '0.55rem 0.75rem', background: readOnly ? COLORS.borderLight : COLORS.bg, border: `1px solid ${COLORS.border}`,
        color: readOnly ? COLORS.textMuted : COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.85rem', boxSizing: 'border-box',
        cursor: readOnly ? 'not-allowed' : 'text' }} />
  </div>
));

const ResultRow = React.memo(({ label, value, indent = 0, bold = false, accent = false, subtle = false, neg = false }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0',
    borderBottom: `1px solid ${COLORS.borderLight}`, paddingLeft: `${indent * 1}rem`,
    fontSize: subtle ? '0.74rem' : '0.83rem' }}>
    <span style={{ color: accent ? COLORS.accent : (subtle ? COLORS.textDim : COLORS.textMuted), fontWeight: bold ? 700 : 500 }}>{label}</span>
    <span style={{ color: accent ? COLORS.accent : (neg ? COLORS.success : COLORS.text), fontWeight: bold ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>
      {neg && value > 0 ? '(' : ''}{fmt(value)}{neg && value > 0 ? ')' : ''}
    </span>
  </div>
));

const Section = React.memo(({ id, title, icon: Icon, children, summary, isOpen, onToggle }) => {
  const embedded = useContext(EmbeddedContext);

  // TD1-style: full-width navy header bar with white uppercase title, gold icon,
  // pronounced navy border around the panel. Public /tax keeps the original
  // gold-text-on-white card look.
  if (embedded) {
    return (
      <div style={{ background: COLORS.card, border: `1.5px solid ${COLORS.frame}`, borderRadius: '3px', marginBottom: '0.9rem', overflow: 'hidden' }}>
        <button onClick={() => onToggle(id)}
          style={{ width: '100%', padding: '0.65rem 1rem', background: COLORS.frame, border: 'none', color: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <Icon size={15} style={{ color: COLORS.accent }} />
            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#ffffff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</span>
            {summary && <span style={{ fontSize: '0.74rem', color: '#cbd5e1', marginLeft: '0.4rem', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{summary}</span>}
          </div>
          {isOpen ? <ChevronUp size={15} color="#ffffff" /> : <ChevronDown size={15} color="#ffffff" />}
        </button>
        {isOpen && <div style={{ padding: '1rem 1.1rem 1.1rem' }}>{children}</div>}
      </div>
    );
  }

  // Public /tax — original style preserved.
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '4px', marginBottom: '0.85rem', overflow: 'hidden' }}>
      <button onClick={() => onToggle(id)}
        style={{ width: '100%', padding: '0.85rem 1.1rem', background: 'transparent', border: 'none', color: COLORS.text,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Icon size={16} style={{ color: COLORS.accent }} />
          <span className="serif" style={{ fontSize: '1.05rem', fontWeight: 600, color: COLORS.accent }}>{title}</span>
          {summary && <span style={{ fontSize: '0.75rem', color: COLORS.textDim, marginLeft: '0.4rem' }}>{summary}</span>}
        </div>
        {isOpen ? <ChevronUp size={15} color={COLORS.textDim} /> : <ChevronDown size={15} color={COLORS.textDim} />}
      </button>
      {isOpen && <div style={{ padding: '0 1.1rem 1.1rem', borderTop: `1px solid ${COLORS.borderLight}`, paddingTop: '1rem' }}>{children}</div>}
    </div>
  );
});

const ComputationPanel = React.memo(({ results, year, isComparison = false, Y }) => {
  const yearColor = year === 2025 ? COLORS.year2025 : COLORS.year2026;
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${isComparison ? yearColor : COLORS.accent}`, borderRadius: '4px', padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', paddingBottom: '0.6rem', borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 className="serif" style={{ fontSize: '1.2rem', fontWeight: 600, color: yearColor, margin: 0 }}>
          <Calculator size={16} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: '-2px' }} />
          Tax Year {year}
        </h2>
        <span style={{ fontSize: '0.65rem', letterSpacing: '0.1em', color: COLORS.textDim, textTransform: 'uppercase', padding: '0.2rem 0.5rem', background: COLORS.bg, borderRadius: '2px' }}>
          {year === 2025 ? 'Pre-Reform' : 'Reform'}
        </span>
      </div>

      <div style={{ marginBottom: '0.85rem' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: yearColor, textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Income</div>
        {results.grossEmployment > 0 && <ResultRow label="Employment" value={results.grossEmployment} />}
        {results.exemptIncome > 0 && <ResultRow label={`Less: ${results.reliefName}`} value={results.exemptIncome} indent={1} subtle neg />}
        {results.ninetyDayApplied && results.ninetyDayExempt > 0 && <ResultRow label={`Less: 90-day rule (${results.daysAbroad}/${results.totalDays} days)`} value={results.ninetyDayExempt} indent={1} subtle neg />}
        {results.grossSelfEmp > 0 && <ResultRow label="Self-employment" value={results.grossSelfEmp} />}
        {results.grossRent > 0 && <ResultRow label="Rental (net of 20% W&T + interest)" value={results.rentNet} />}
        {results.foreignPensionAddedToProgressive > 0 && <ResultRow label="Foreign pension (progressive)" value={results.foreignPensionAddedToProgressive} />}
        {results.cyprusPensionAddedToProgressive > 0 && <ResultRow label="Cyprus pension" value={results.cyprusPensionAddedToProgressive} />}
        {results.lifeRedemptionAddback > 0 && <ResultRow label="Life policy early-redemption add-back" value={results.lifeRedemptionAddback} />}
        {results.royaltyTaxable > 0 && (
          <>
            {results.royaltyQualifying > 0 && <ResultRow label="Qualifying IP royalties (gross)" value={results.royaltyQualifying} />}
            {results.royaltyQualifying > 0 && <ResultRow label="Less: IP Box 80% deemed expense" value={results.royaltyExempt} indent={1} subtle neg />}
            {results.royaltyOrdinary > 0 && <ResultRow label="Ordinary royalties" value={results.royaltyOrdinary} />}
          </>
        )}
        {results.courtOrder > 0 && <ResultRow label="Court order / will / contract" value={results.courtOrder} />}
        {results.goodwill > 0 && <ResultRow label="Trading goodwill" value={results.goodwill} />}
        {results.cryptoMining > 0 && <ResultRow label="Crypto from mining" value={results.cryptoMining} />}
        {results.otherInc > 0 && <ResultRow label="Other income" value={results.otherInc} />}
        <ResultRow label="Income for PIT" value={results.totalProgressiveIncome} bold />
      </div>

      {results.totalDeductions > 0 && (
        <div style={{ marginBottom: '0.85rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: yearColor, textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Deductions</div>
          {results.totalSI > 0 && <ResultRow label="Social Insurance" value={results.totalSI} indent={1} neg />}
          {results.totalGHS > 0 && <ResultRow label="GHS" value={results.totalGHS} indent={1} neg />}
          {results.cappedOptional > 0 && <ResultRow label="Pension/Medical/Life" value={results.cappedOptional} indent={1} neg />}
          {results.donationsAllowed > 0 && <ResultRow label="Donations" value={results.donationsAllowed} indent={1} neg />}
          {results.subscriptionsAllowed > 0 && <ResultRow label="Subscriptions" value={results.subscriptionsAllowed} indent={1} neg />}
          {results.innovativeAllowed > 0 && <ResultRow label="Innovative business investment" value={results.innovativeAllowed} indent={1} neg />}
          {results.lossesUsed > 0 && <ResultRow label="Losses b/f" value={results.lossesUsed} indent={1} neg />}
          {results.total2026Allowances > 0 && <ResultRow label="2026 family/housing allowances" value={results.total2026Allowances} indent={1} neg accent />}
        </div>
      )}

      <div style={{ background: COLORS.cardLight, padding: '0.6rem', borderRadius: '3px', marginBottom: '0.85rem', border: `1px solid ${COLORS.border}` }}>
        <ResultRow label="CHARGEABLE INCOME" value={results.chargeableIncome} bold accent />
      </div>

      {results.bandBreakdown.length > 0 && (
        <div style={{ marginBottom: '0.85rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: yearColor, textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Income Tax</div>
          {results.bandBreakdown.map((b, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', padding: '0.2rem 0', color: COLORS.textMuted }}>
              <span>{b.range} @ {(b.rate * 100).toFixed(0)}%</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: COLORS.text }}>{fmt(b.tax)}</span>
            </div>
          ))}
          <ResultRow label="PIT Total" value={results.pit} bold accent />
        </div>
      )}

      {results.totalSDC > 0 && (
        <div style={{ marginBottom: '0.85rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: yearColor, textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>SDC (Defence)</div>
          {results.sdcDividends > 0 && <ResultRow label={`Dividends @ ${(Y.sdcRates.dividends * 100).toFixed(0)}%`} value={results.sdcDividends} />}
          {results.sdcInterest > 0 && <ResultRow label={`Interest @ ${(Y.sdcRates.interest * 100).toFixed(0)}%`} value={results.sdcInterest} />}
          {results.sdcRental > 0 && <ResultRow label="Rental @ 2.25%" value={results.sdcRental} />}
          <ResultRow label="Total SDC" value={results.totalSDC} bold />
        </div>
      )}

      {(results.cryptoTax > 0 || results.foreignPensionFlatTax > 0 || results.cyprusPensionFlatTax > 0) && (
        <div style={{ marginBottom: '0.85rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: yearColor, textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Flat-Rate Taxes</div>
          {results.cryptoTax > 0 && <ResultRow label="Crypto disposal (8%)" value={results.cryptoTax} />}
          {results.foreignPensionFlatTax > 0 && <ResultRow label="Foreign pension (5% over €5K)" value={results.foreignPensionFlatTax} />}
          {results.cyprusPensionFlatTax > 0 && <ResultRow label="Widow's pension (20% over €19,500)" value={results.cyprusPensionFlatTax} />}
        </div>
      )}

      {(results.capGainsSharesAmount > 0 || results.capGainsPropertyAmount > 0) && (
        <div style={{ marginBottom: '0.85rem', padding: '0.5rem', background: COLORS.bg, borderRadius: '3px', borderLeft: `2px solid ${COLORS.success}` }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: COLORS.success, textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.4rem' }}>Capital Gains (Info Only)</div>
          {results.capGainsSharesAmount > 0 && <ResultRow label="Shares/securities (0% PIT)" value={results.capGainsSharesAmount} subtle />}
          {results.capGainsPropertyAmount > 0 && <ResultRow label="Cyprus property (separate CGT 20%)" value={results.capGainsPropertyAmount} subtle />}
        </div>
      )}

      <div style={{ background: COLORS.cardLight, border: `2px solid ${yearColor}`, padding: '0.85rem', borderRadius: '4px', marginTop: '0.85rem' }}>
        <ResultRow label="Total Tax" value={results.totalTax} bold />
        <ResultRow label="Contributions (SI + GHS)" value={results.totalContributions} bold />
        <div style={{ borderTop: `2px solid ${yearColor}`, marginTop: '0.4rem', paddingTop: '0.4rem' }}>
          <ResultRow label="TOTAL LIABILITY" value={results.totalLiability} bold accent />
        </div>
        <div style={{ marginTop: '0.6rem', textAlign: 'center', padding: '0.6rem', background: COLORS.card, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px' }}>
          <div style={{ fontSize: '0.6rem', letterSpacing: '0.15em', color: yearColor, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Net Take-Home</div>
          <div className="serif" style={{ fontSize: '1.6rem', fontWeight: 700, color: yearColor, lineHeight: 1.1 }}>{fmt(results.netIncome)}</div>
          <div style={{ fontSize: '0.66rem', color: COLORS.textDim, marginTop: '0.2rem' }}>
            Effective: {results.effectiveRate.toFixed(2)}% · Monthly: {fmt(results.netIncome / 12)}
          </div>
        </div>
      </div>
    </div>
  );
});

// ============ MAIN COMPONENT ============
// Props (all optional, for portal embedding):
//   clientPrefill { name, tic, idNumber, dob, siNumber, address } — pulled from the clients table
//   initialState  — previously-saved input_data; restores every field
//   onSave(inputData, snapshot)  — called by the Save button; snapshot = { year, results }
//   taxYearLock  — when editing an existing return, lock the year selector to this year
//   formType      — 'individuals' | 'self_employed' (Chunk D wires this to a different field layout;
//                   for now it's just stored on the row and shown in the tab header)
//   onSaveXmlToClient(xml, filename) — portal-only; files the generated TaxisNet XML into the
//                   client's Documents folder. When absent (public /tax), the XML only downloads.
export default function CyprusTaxCalculatorWithPDF({ clientPrefill, initialState, onSave, taxYearLock, formType, onSaveXmlToClient } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void formType; // referenced to silence unused-prop warnings until Chunk D consumes it
  // Pull a previously-saved value if present, else use the supplied fallback.
  const init = (key, fallback) =>
    (initialState && initialState[key] !== undefined && initialState[key] !== null) ? initialState[key] : fallback;
  // Client identification: clientPrefill wins over saved state.
  const initClient = (prefillKey, stateKey) =>
    (clientPrefill && clientPrefill[prefillKey] != null && clientPrefill[prefillKey] !== '')
      ? clientPrefill[prefillKey] : init(stateKey, '');
  const embedded = !!clientPrefill || !!onSave;

  const [selectedYear, setSelectedYear] = useState(taxYearLock ?? init('selectedYear', 2026));
  const [comparisonMode, setComparisonMode] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [printFriendlyMode, setPrintFriendlyMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error

  // Client details (prefill from client record when embedded; otherwise from saved state)
  const [clientName, setClientName] = useState(initClient('name', 'clientName'));
  const [clientTIC, setClientTIC] = useState(initClient('tic', 'clientTIC'));
  const [clientID, setClientID] = useState(initClient('idNumber', 'clientID'));
  const [clientDOB, setClientDOB] = useState(initClient('dob', 'clientDOB'));
  const [clientSSN, setClientSSN] = useState(initClient('siNumber', 'clientSSN'));
  const [clientAddress, setClientAddress] = useState(initClient('address', 'clientAddress'));

  // All other state...
  // Salaried Services (TD1 Part 4.A) — array of employment rows.
  // Legacy saves with `employmentIncome` + `bik` migrate to a single-row array.
  const [employments, setEmployments] = useState(() => initEmployments(initialState));
  const [selfEmpIncome, setSelfEmpIncome] = useState(init('selfEmpIncome', ''));
  // Rental properties (TD1 Part 4.C) — array of property rows. Replaces the
  // three legacy single-value fields (rentalIncome, rentalInterest, rentalMaintenance).
  const [rentalProperties, setRentalProperties] = useState(() => initRentalProperties(initialState));
  // Pensions (TD1 Part 4.B) — array of pension rows. Replaces the four legacy
  // single-value fields (foreignPensionIncome/Elect, cyprusPensionIncome/Elect).
  const [pensions, setPensions] = useState(() => initPensions(initialState));
  const [otherIncome, setOtherIncome] = useState(init('otherIncome', ''));
  const [dividendIncome, setDividendIncome] = useState(init('dividendIncome', ''));
  const [interestIncome, setInterestIncome] = useState(init('interestIncome', ''));
  // B3 (portal-only): per-source arrays for TD1 Part 4.E / 4.F. The legacy single-field
  // state above stays for the public /tax route; the portal swaps to the row UIs.
  const [interestSources, setInterestSources] = useState(() => initInterestSources(initialState));
  const [dividendSources, setDividendSources] = useState(() => initDividendSources(initialState));
  // B3b (portal-only): Life insurance redemption rows (TD1 Part 4.G).
  const [lifeRedemptions, setLifeRedemptions] = useState(() => initLifeRedemptions(initialState));
  // B3c (portal-only): Part 5.C life/SI/pension fund rows.
  const [lifeSiPensionFunds, setLifeSiPensionFunds] = useState(() => initLifeSiPensionFunds(initialState));
  // B3c (portal-only): Part 5.B innovative business investments.
  const [innovativeInvestments, setInnovativeInvestments] = useState(() => initInnovativeInvestments(initialState));
  // Chunk D (portal-only, self-employed form): Part 4.1 trade/industry activities + Part 4.3 partnerships.
  const [selfEmployedActivities, setSelfEmployedActivities] = useState(() => initSelfEmployedActivities(initialState));
  const [partnerships, setPartnerships] = useState(() => initPartnerships(initialState));
  // Chunk D: Part 3.C books / audited accounts metadata (form-fill only — no calc impact)
  const [selfEmpTurnoverUnder70k, setSelfEmpTurnoverUnder70k] = useState(init('selfEmpTurnoverUnder70k', false));
  const [selfEmpAuditedAccounts, setSelfEmpAuditedAccounts] = useState(init('selfEmpAuditedAccounts', 'none'));
  // Chunk D: Part 4.2 gain/loss on disposal of immovable property / shares in private company
  const [disposalGainImmovable, setDisposalGainImmovable] = useState(init('disposalGainImmovable', ''));
  const [disposalLossImmovable, setDisposalLossImmovable] = useState(init('disposalLossImmovable', ''));
  const [disposalGainShares, setDisposalGainShares] = useState(init('disposalGainShares', ''));
  const [disposalLossShares, setDisposalLossShares] = useState(init('disposalLossShares', ''));
  const [disposalTicOfCompany, setDisposalTicOfCompany] = useState(init('disposalTicOfCompany', ''));
  const [disposalCountry, setDisposalCountry] = useState(init('disposalCountry', ''));
  // B3b (portal-only): Additional Part 5.A miscellaneous deductions beyond donations + profSubs.
  const [tradeUnionContrib, setTradeUnionContrib] = useState(init('tradeUnionContrib', ''));
  const [politicalPartyDonations, setPoliticalPartyDonations] = useState(init('politicalPartyDonations', ''));
  const [broaderPublicSectorReduction, setBroaderPublicSectorReduction] = useState(init('broaderPublicSectorReduction', ''));
  const [communityOfficerExpenses, setCommunityOfficerExpenses] = useState(init('communityOfficerExpenses', ''));
  const [cryptoGains, setCryptoGains] = useState(init('cryptoGains', ''));
  const [foreignReliefType, setForeignReliefType] = useState(init('foreignReliefType', 'none'));
  const [isNonDom, setIsNonDom] = useState(init('isNonDom', false));
  const [pensionContrib, setPensionContrib] = useState(init('pensionContrib', ''));
  const [medicalContrib, setMedicalContrib] = useState(init('medicalContrib', ''));
  const [lifeInsurance, setLifeInsurance] = useState(init('lifeInsurance', ''));
  const [lifeSumAssured, setLifeSumAssured] = useState(init('lifeSumAssured', ''));
  const [donations, setDonations] = useState(init('donations', ''));
  const [profSubscriptions, setProfSubscriptions] = useState(init('profSubscriptions', ''));
  const [lossesCarriedForward, setLossesCarriedForward] = useState(init('lossesCarriedForward', ''));
  const [numChildren, setNumChildren] = useState(init('numChildren', 0));
  const [numStudents, setNumStudents] = useState(init('numStudents', 0));
  const [mortgageOrRent, setMortgageOrRent] = useState(init('mortgageOrRent', ''));
  const [greenSpend, setGreenSpend] = useState(init('greenSpend', ''));
  const [homeInsurance, setHomeInsurance] = useState(init('homeInsurance', ''));

  // ========== NEW COMPREHENSIVE FIELDS ==========
  // Personal Profile
  const [taxResident, setTaxResident] = useState(init('taxResident', true));
  const [residencyRule, setResidencyRule] = useState(init('residencyRule', '183'));
  const [firstEmployment, setFirstEmployment] = useState(init('firstEmployment', false));
  const [hasDisability, setHasDisability] = useState(init('hasDisability', false));
  const [hasDisabledDependant, setHasDisabledDependant] = useState(init('hasDisabledDependant', false));
  const [isOver65, setIsOver65] = useState(init('isOver65', false));

  // Additional Income Sources (pensions moved into `pensions[]` above)
  const [royaltyIncomeQualifying, setRoyaltyIncomeQualifying] = useState(init('royaltyIncomeQualifying', ''));
  const [royaltyIncomeOrdinary, setRoyaltyIncomeOrdinary] = useState(init('royaltyIncomeOrdinary', ''));
  const [courtOrderIncome, setCourtOrderIncome] = useState(init('courtOrderIncome', ''));
  const [tradingGoodwill, setTradingGoodwill] = useState(init('tradingGoodwill', ''));

  // Capital Gains (Display Only)
  const [capitalGainsShares, setCapitalGainsShares] = useState(init('capitalGainsShares', ''));
  const [capitalGainsProperty, setCapitalGainsProperty] = useState(init('capitalGainsProperty', ''));
  const [capitalGainsCryptoMining, setCapitalGainsCryptoMining] = useState(init('capitalGainsCryptoMining', ''));

  // 90-day rule (foreign work)
  const [daysWorkedAbroad, setDaysWorkedAbroad] = useState(init('daysWorkedAbroad', ''));
  const [totalWorkDays, setTotalWorkDays] = useState(init('totalWorkDays', '260'));
  const [foreignEmployer, setForeignEmployer] = useState(init('foreignEmployer', false));

  // Additional Deductions
  // (legacy rentalMaintenance state has moved into per-property capitalAllowances above)
  const [capitalAllowances, setCapitalAllowances] = useState(init('capitalAllowances', ''));
  const [badDebts, setBadDebts] = useState(init('badDebts', ''));
  const [disabilityAllowance, setDisabilityAllowance] = useState(init('disabilityAllowance', ''));

  // Display tracker
  const [showCapitalGainsInfo, setShowCapitalGainsInfo] = useState(false);

  // When embedded, open Income by default (Client Details are shown as a read-only header).
  const [openSections, setOpenSections] = useState({ client: false, profile: false, income: embedded, capitalgains: false, special: false, deductions: false, allowances: false });

  const toggleSection = useCallback((key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ============ EMPLOYMENT ROW MUTATORS ============
  const addEmployment = useCallback(() => {
    setEmployments(prev => [...prev, emptyEmployment()]);
  }, []);
  const removeEmployment = useCallback((id) => {
    setEmployments(prev => prev.length <= 1 ? prev : prev.filter(e => e.id !== id));
  }, []);
  const updateEmployment = useCallback((id, field, value) => {
    setEmployments(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }, []);

  // ============ PENSION ROW MUTATORS ============
  const addPension = useCallback(() => {
    setPensions(prev => [...prev, emptyPension()]);
  }, []);
  const removePension = useCallback((id) => {
    setPensions(prev => prev.filter(p => p.id !== id));
  }, []);
  const updatePension = useCallback((id, field, value) => {
    setPensions(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }, []);

  // ============ RENTAL PROPERTY MUTATORS ============
  const addRentalProperty = useCallback(() => {
    setRentalProperties(prev => [...prev, emptyRentalProperty()]);
  }, []);
  const removeRentalProperty = useCallback((id) => {
    setRentalProperties(prev => prev.filter(r => r.id !== id));
  }, []);
  const updateRentalProperty = useCallback((id, field, value) => {
    setRentalProperties(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  // ============ LIFE REDEMPTION MUTATORS (portal-only) ============
  const addLifeRedemption = useCallback(() => {
    setLifeRedemptions(prev => [...prev, emptyLifeRedemption()]);
  }, []);
  const removeLifeRedemption = useCallback((id) => {
    setLifeRedemptions(prev => prev.filter(r => r.id !== id));
  }, []);
  const updateLifeRedemption = useCallback((id, field, value) => {
    setLifeRedemptions(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  // ============ PART 5.C + 5.B MUTATORS (portal-only) ============
  const addLifeSiPensionFund = useCallback(() => {
    setLifeSiPensionFunds(prev => [...prev, emptyLifeSiPensionFund()]);
  }, []);
  const removeLifeSiPensionFund = useCallback((id) => {
    setLifeSiPensionFunds(prev => prev.filter(r => r.id !== id));
  }, []);
  const updateLifeSiPensionFund = useCallback((id, field, value) => {
    setLifeSiPensionFunds(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);
  const addInnovativeInvestment = useCallback(() => {
    setInnovativeInvestments(prev => [...prev, emptyInnovativeInvestment()]);
  }, []);
  const removeInnovativeInvestment = useCallback((id) => {
    setInnovativeInvestments(prev => prev.filter(r => r.id !== id));
  }, []);
  const updateInnovativeInvestment = useCallback((id, field, value) => {
    setInnovativeInvestments(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  // ============ SELF-EMP ACTIVITY + PARTNERSHIP MUTATORS ============
  // Self-employed clients file exactly one trade activity per return — only
  // `updateSelfEmpActivity` is exposed. There is no add/remove for that array.
  const updateSelfEmpActivity = useCallback((id, field, value) => {
    setSelfEmployedActivities(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  }, []);
  const addPartnership = useCallback(() => {
    setPartnerships(prev => [...prev, emptyPartnership()]);
  }, []);
  const removePartnership = useCallback((id) => {
    setPartnerships(prev => prev.filter(p => p.id !== id));
  }, []);
  const updatePartnership = useCallback((id, field, value) => {
    setPartnerships(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }, []);

  // ============ INTEREST + DIVIDEND ROW MUTATORS (portal-only) ============
  const addInterestSource = useCallback(() => {
    setInterestSources(prev => [...prev, emptyInterestSource()]);
  }, []);
  const removeInterestSource = useCallback((id) => {
    setInterestSources(prev => prev.filter(s => s.id !== id));
  }, []);
  const updateInterestSource = useCallback((id, field, value) => {
    setInterestSources(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);
  const addDividendSource = useCallback(() => {
    setDividendSources(prev => [...prev, emptyDividendSource()]);
  }, []);
  const removeDividendSource = useCallback((id) => {
    setDividendSources(prev => prev.filter(s => s.id !== id));
  }, []);
  const updateDividendSource = useCallback((id, field, value) => {
    setDividendSources(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  const calculate = useCallback((yearKey) => {
    const Y = TAX_YEARS[yearKey];
    const num = (v) => parseFloat(v) || 0;
    // ============ EMPLOYMENT TOTALS (sum across employments[]) ============
    // employmentInRepublic — drives SI/GHS base. employmentOutsideRepublic is added to
    // gross for tax purposes but not for Cyprus SI/GHS. BIK is per-row and tax-only.
    const employmentInRepublic = employments.reduce((s, e) => s + num(e.grossInRepublic), 0);
    const employmentOutsideRepublic = employments.reduce((s, e) => s + num(e.grossOutsideRepublic), 0);
    const employmentBik = employments.reduce((s, e) => s + num(e.bik), 0);
    const employmentTaxWithheld = employments.reduce((s, e) => s + num(e.taxWithheld), 0);
    const employmentGhsWithheld = employments.reduce((s, e) => s + num(e.ghsWithheld), 0);
    const grossEmployment = employmentInRepublic + employmentOutsideRepublic + employmentBik;
    // Self-employed income: when arrays have rows, sum taxable profit minus current-year
    // losses across activities + partnerships. Otherwise fall back to legacy selfEmpIncome.
    const activityNet = selfEmployedActivities.reduce((s, a) =>
      s + num(a.taxableProfit) - num(a.lossCurrentYear), 0);
    const partnershipNet = partnerships.reduce((s, p) =>
      s + num(p.tradingIncome) + num(p.salary) + num(p.interestOnCapital) - num(p.tradingLoss), 0);
    const useSelfEmpArrays = selfEmployedActivities.length > 0 || partnerships.length > 0;
    const grossSelfEmp = useSelfEmpArrays ? (activityNet + partnershipNet) : num(selfEmpIncome);
    // ============ RENTAL PROPERTIES (TD1 Part 4.C — aggregated across rentalProperties[]) ============
    // For B2 we sum across properties and apply the existing rentNet formula. Per-type
    // SDC rates (3% office/shop/flat/house, 4% storehouse, 0% land/parking, etc.) come later.
    const rentalGrossInRepublic   = rentalProperties.reduce((s, r) => s + num(r.annualGrossInRepublic), 0);
    const rentalGrossOutside      = rentalProperties.reduce((s, r) => s + num(r.annualGrossOutsideRepublic), 0);
    const rentalInterestTotal     = rentalProperties.reduce((s, r) => s + num(r.interestPayable), 0);
    const rentalCapitalAllowances = rentalProperties.reduce((s, r) => s + num(r.capitalAllowances), 0);
    const rentalSdcWithheld       = rentalProperties.reduce((s, r) => s + num(r.sdcWithheld), 0);
    const rentalGhsWithheldByTenant = rentalProperties.reduce((s, r) => s + num(r.ghsWithheld), 0);
    // Keep the old field names so downstream references (passiveBase, totalGrossIncome,
    // familyIncome, etc.) and outputs that read `grossRent` keep working.
    const grossRent = rentalGrossInRepublic + rentalGrossOutside;
    const rentalMaintNum = rentalCapitalAllowances; // capital allowances are the modern equivalent
    const rentNet = Math.max(0, grossRent * 0.80 - rentalInterestTotal - rentalMaintNum);

    // ============ PENSIONS (TD1 Part 4.B — aggregated across pensions[]) ============
    // Per-row code drives the treatment. Old aggregate names (`foreignPension`,
    // `cyprusPension`, `foreignPensionFlatTax`, `cyprusPensionFlatTax`,
    // `foreignPensionAddedToProgressive`, `cyprusPensionAddedToProgressive`)
    // are preserved so downstream sums/labels keep working.
    const foreignPension = pensions.filter(p => p.code === '2' || p.code === '8').reduce((s, p) => s + num(p.amount), 0);
    const cyprusPension  = pensions.filter(p => !['2', '8'].includes(p.code)).reduce((s, p) => s + num(p.amount), 0);
    let foreignPensionFlatTax = 0;
    let foreignPensionAddedToProgressive = 0;
    let cyprusPensionFlatTax = 0;
    let cyprusPensionAddedToProgressive = 0;
    for (const p of pensions) {
      const amt = num(p.amount);
      if (amt <= 0) continue;
      const t = PENSION_CODE_TAXATION[p.code] || 'progressive';
      if (t === 'foreignFlat') {
        if (amt > Y.foreignPensionThreshold) {
          foreignPensionFlatTax += (amt - Y.foreignPensionThreshold) * Y.flatRates.foreignPension;
        }
      } else if (t === 'widowFlat') {
        // TD1 note 5: widow's pension special rate = 20% per euro exceeding €19,500
        if (amt > 19500) {
          cyprusPensionFlatTax += (amt - 19500) * 0.20;
        }
      } else if (t === 'progressive') {
        if (p.code === '8') foreignPensionAddedToProgressive += amt;
        else cyprusPensionAddedToProgressive += amt;
      }
      // taxation === 'exempt' → ignored from taxable income
    }
    const pensionTaxWithheld = pensions.reduce((s, p) => s + num(p.taxWithheld), 0);
    const pensionGhsWithheld = pensions.reduce((s, p) => s + num(p.ghsWithheld), 0);

    // ============ ROYALTIES (IP BOX) ============
    const royaltyQualifying = num(royaltyIncomeQualifying);
    const royaltyOrdinary = num(royaltyIncomeOrdinary);
    const royaltyExempt = royaltyQualifying * 0.80; // 80% exempt under IP Box
    const royaltyTaxable = royaltyQualifying * 0.20 + royaltyOrdinary; // 20% of qualifying + 100% of ordinary

    // ============ OTHER NEW INCOME SOURCES ============
    const courtOrder = num(courtOrderIncome);
    const goodwill = num(tradingGoodwill);
    const cryptoMining = num(capitalGainsCryptoMining);

    const otherInc = num(otherIncome);

    // ============ FOREIGN EMPLOYEE / FIRST-EMPLOYMENT EXEMPTIONS ============
    let exemptIncome = 0;
    let reliefName = '';
    if (foreignReliefType === 'fifty' && grossEmployment > Y.foreignReliefThreshold) {
      exemptIncome = grossEmployment * 0.50;
      reliefName = `50% foreign employee exemption (${Y.foreignReliefDuration} yrs)`;
    } else if (foreignReliefType === 'twenty') {
      exemptIncome = Math.min(grossEmployment * 0.20, Y.foreignRelief20Cap);
      reliefName = '20% foreign employee exemption (5 yrs)';
    } else if (firstEmployment) {
      // First employment exemption (overlap with 20% rule, but track separately)
      exemptIncome = Math.min(grossEmployment * 0.20, Y.foreignRelief20Cap);
      reliefName = 'First-employment exemption (20%, max €8,550)';
    }
    const employmentAfterFirstExemption = grossEmployment - exemptIncome;

    // ============ 90-DAY RULE EXEMPTION ============
    let ninetyDayExempt = 0;
    let ninetyDayApplied = false;
    const daysAbroad = num(daysWorkedAbroad);
    const totalDays = num(totalWorkDays) || 260;
    if (foreignEmployer && daysAbroad > 90 && totalDays > 0) {
      // Pro-rata exemption: (days abroad / total days) × employment income (after other exemptions)
      ninetyDayExempt = (daysAbroad / totalDays) * employmentAfterFirstExemption;
      ninetyDayApplied = true;
    }
    const employmentAfterAllExemptions = employmentAfterFirstExemption - ninetyDayExempt;

    // ============ LIFE INSURANCE REDEMPTION ADD-BACK (TD1 Part 4.G + note 1) ============
    // Early redemption of life policies adds part of previously-deducted premiums back to income:
    //   < 3 years from issue → 30%; 3–6 years → 20%; > 6 years → 0%.
    const lifeRedemptionAddback = lifeRedemptions.reduce((sum, r) => {
      const premiums = num(r.premiumsDeducted);
      if (premiums <= 0 || !r.issueDate || !r.cancellationDate) return sum;
      const issue = new Date(r.issueDate);
      const cancel = new Date(r.cancellationDate);
      if (isNaN(issue.getTime()) || isNaN(cancel.getTime())) return sum;
      const years = (cancel.getTime() - issue.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (years < 3) return sum + premiums * 0.30;
      if (years < 6) return sum + premiums * 0.20;
      return sum;
    }, 0);

    // ============ TOTAL PROGRESSIVE INCOME ============
    const totalProgressiveIncome =
      employmentAfterAllExemptions +
      grossSelfEmp +
      rentNet +
      foreignPensionAddedToProgressive +
      cyprusPensionAddedToProgressive +
      royaltyTaxable +
      courtOrder +
      goodwill +
      cryptoMining +
      lifeRedemptionAddback +
      otherInc;

    // ============ SI & GHS ============
    // Age 65+ exempt from Social Insurance (Cyprus pensionable age). GHS still applies to pensioners.
    // If DOB is provided, auto-derive from age at 31 Dec of yearKey; else fall back to the manual checkbox.
    let effectiveOver65 = isOver65;
    let ageAtYearEnd = null;
    if (clientDOB) {
      const dob = new Date(clientDOB);
      if (!isNaN(dob.getTime())) {
        const yearEnd = new Date(yearKey, 11, 31);
        let age = yearEnd.getFullYear() - dob.getFullYear();
        const mDiff = yearEnd.getMonth() - dob.getMonth();
        if (mDiff < 0 || (mDiff === 0 && yearEnd.getDate() < dob.getDate())) age--;
        ageAtYearEnd = age;
        effectiveOver65 = age >= 65;
      }
    }
    // SI/GHS base: in-Republic employment only (sum across rows).
    const annualEmployment = employmentInRepublic;
    const empSiBase = Math.min(annualEmployment, Y.siCap);
    const empSi = effectiveOver65 ? 0 : empSiBase * Y.siRates.employee;
    const empGhs = Math.min(annualEmployment, Y.ghsCap) * Y.ghsRates.employee;
    const seSiBase = Math.min(grossSelfEmp, Y.siCap);
    const seSi = effectiveOver65 ? 0 : seSiBase * Y.siRates.selfEmployed;
    const seGhs = Math.min(grossSelfEmp, Y.ghsCap) * Y.ghsRates.selfEmployed;
    const passiveBase = Math.min(grossRent + foreignPension + cyprusPension + otherInc + royaltyTaxable, Y.ghsCap);
    const passiveGhs = passiveBase * Y.ghsRates.passive;

    const totalSI = empSi + seSi;

    // ============ DEDUCTIONS ============
    const ownSI_GHS = totalSI + empGhs + seGhs + passiveGhs;
    const medicalCap = Y.newAllowances ? 0.02 : 0.015;

    // B3c: Part 5.C — Life/SI/Pension funds. When the portal array has rows, derive
    // each per-code bucket from it; otherwise fall back to the legacy single fields.
    // Code 2 (SIS) is informational only — SI is already auto-computed above.
    let pensionFromArray = 0;        // codes 1 + 5 + 6 → share the 10%-of-employment cap
    let lifeAllowedFromArray = 0;    // code 3 → per-row 7%-of-sum-assured cap
    let medicalFromArray = 0;        // code 4 → 1.5%/2% cap
    for (const r of lifeSiPensionFunds) {
      const paid = num(r.amountPaid);
      if (paid <= 0) continue;
      switch (r.code) {
        case '1': pensionFromArray += paid; break;
        case '5': pensionFromArray += paid; break;
        case '6': pensionFromArray += paid; break;
        case '3': {
          const sum = num(r.sumAssured);
          lifeAllowedFromArray += sum > 0 ? Math.min(paid, sum * 0.07) : paid;
          break;
        }
        case '4': medicalFromArray += paid; break;
        // case '2' (SIS): informational only — skip
      }
    }
    const usePart5cArray = lifeSiPensionFunds.length > 0;
    const pensionAllowed = usePart5cArray
      ? Math.min(pensionFromArray, annualEmployment * 0.10)
      : Math.min(num(pensionContrib), annualEmployment * 0.10);
    const medicalAllowed = usePart5cArray
      ? Math.min(medicalFromArray, annualEmployment * medicalCap)
      : Math.min(num(medicalContrib), annualEmployment * medicalCap);
    const lifePremium = num(lifeInsurance);
    const lifeSum = num(lifeSumAssured);
    const lifeAllowed = usePart5cArray
      ? lifeAllowedFromArray
      : (lifeSum > 0 ? Math.min(lifePremium, lifeSum * 0.07) : lifePremium);
    const donationsAllowed = num(donations);
    const subscriptionsAllowed = num(profSubscriptions);
    // B3b: additional Part 5.A miscellaneous deductions (portal-only state; 0 in public mode).
    // Political party donations capped at €50,000 per TD1 income tax computation note.
    // Broader public sector reduction is grouped separately per the TD1 form but folded into
    // the same overall deductions bucket here.
    const tradeUnionAllowed = num(tradeUnionContrib);
    const politicalPartyAllowed = Math.min(num(politicalPartyDonations), 50000);
    const broaderPublicSectorAllowed = num(broaderPublicSectorReduction);
    const communityOfficerAllowed = num(communityOfficerExpenses);
    const part5AExtras = tradeUnionAllowed + politicalPartyAllowed + broaderPublicSectorAllowed + communityOfficerAllowed;

    // New self-employed deductions
    const capAllowancesAllowed = num(capitalAllowances);
    const badDebtsAllowed = num(badDebts);
    const disabilityAllowed = num(disabilityAllowance);

    const incomeBeforeOptional = totalProgressiveIncome - ownSI_GHS - donationsAllowed - subscriptionsAllowed - part5AExtras - capAllowancesAllowed - badDebtsAllowed - disabilityAllowed;
    const optionalCap = incomeBeforeOptional * 0.20;
    const totalOptional = pensionAllowed + medicalAllowed + lifeAllowed;
    const cappedOptional = Math.min(totalOptional, optionalCap);

    const totalDeductions = ownSI_GHS + donationsAllowed + subscriptionsAllowed + part5AExtras + capAllowancesAllowed + badDebtsAllowed + disabilityAllowed + cappedOptional;
    const lossesUsed = Math.min(num(lossesCarriedForward), Math.max(0, totalProgressiveIncome - totalDeductions));

    // ============ 2026 FAMILY/HOUSING ALLOWANCES ============
    let total2026Allowances = 0;
    let eligibleFamily = false;
    let familyThreshold = 0;
    let childAllowance = 0, studentAllowance = 0, housingAllowance = 0, greenAllowance = 0, homeInsAllowance = 0;
    if (Y.newAllowances) {
      const totalDeps = numChildren + numStudents;
      const familyIncome = annualEmployment + grossSelfEmp + grossRent + foreignPension + cyprusPension + otherInc + royaltyQualifying + royaltyOrdinary;
      if (totalDeps === 0) familyThreshold = Y.familyThresholds[0];
      else if (totalDeps <= 2) familyThreshold = Y.familyThresholds['1-2'];
      else if (totalDeps <= 4) familyThreshold = Y.familyThresholds['3-4'];
      else familyThreshold = Y.familyThresholds['5+'];
      eligibleFamily = familyIncome <= familyThreshold;
      if (eligibleFamily) {
        for (let i = 0; i < totalDeps; i++) {
          const amt = Y.childAmounts[Math.min(i, 2)];
          if (i < numChildren) childAllowance += amt;
          else studentAllowance += amt;
        }
        housingAllowance = Math.min(num(mortgageOrRent), Y.housingMax);
        greenAllowance = Math.min(num(greenSpend), Y.greenMax);
        homeInsAllowance = Math.min(num(homeInsurance), Y.homeInsuranceMax);
      }
      total2026Allowances = childAllowance + studentAllowance + housingAllowance + greenAllowance + homeInsAllowance;
    }

    // B3c: Part 5.B — Investment in innovative businesses. Per TD1, claim is capped
    // at 50% of taxable income after all OTHER deductions (incl. medical, life, etc.).
    const baseBeforeInnovative = Math.max(0, totalProgressiveIncome - totalDeductions - lossesUsed - total2026Allowances);
    const innovativeClaimRaw = innovativeInvestments.reduce((s, r) => s + num(r.amountToClaim), 0);
    const innovativeAllowed = Math.min(innovativeClaimRaw, baseBeforeInnovative * 0.50);
    const chargeableIncome = Math.max(0, baseBeforeInnovative - innovativeAllowed);

    // ============ PIT CALCULATION ============
    let pit = 0;
    const bandBreakdown = [];
    for (const band of Y.bands) {
      if (chargeableIncome > band.min) {
        const taxableInBand = Math.min(chargeableIncome, band.max) - band.min;
        const taxInBand = taxableInBand * band.rate;
        pit += taxInBand;
        if (taxableInBand > 0) {
          bandBreakdown.push({
            range: band.max === Infinity ? `Over €${band.min.toLocaleString()}` : `€${band.min.toLocaleString()} - €${band.max.toLocaleString()}`,
            rate: band.rate, taxable: taxableInBand, tax: taxInBand,
          });
        }
      }
    }

    // ============ INTEREST + DIVIDEND TOTALS ============
    // When the portal-only row arrays are populated, they win over the legacy single
    // fields. This keeps the public /tax calculator using interestIncome / dividendIncome
    // as before while the portal sums across rows.
    const interestArraySum = interestSources.reduce((s, x) => s + num(x.grossInterest), 0);
    const dividendArraySum = dividendSources.reduce((s, x) => s + num(x.grossDividend), 0);
    const effectiveInterest = interestSources.length > 0 ? interestArraySum : num(interestIncome);
    const effectiveDividend = dividendSources.length > 0 ? dividendArraySum : num(dividendIncome);

    // ============ SDC (only Cyprus tax residents who are also domiciled) ============
    const sdcDividends = (isNonDom || !taxResident) ? 0 : effectiveDividend * Y.sdcRates.dividends;
    const sdcInterest = (isNonDom || !taxResident) ? 0 : effectiveInterest * Y.sdcRates.interest;
    const sdcRental = (isNonDom || !taxResident) ? 0 : grossRent * Y.sdcRates.rental;
    const totalSDC = sdcDividends + sdcInterest + sdcRental;

    const passiveGhsAddl = Math.min(effectiveDividend + effectiveInterest, Math.max(0, Y.ghsCap - passiveBase)) * Y.ghsRates.passive;
    const totalGHS = empGhs + seGhs + passiveGhs + passiveGhsAddl;

    // ============ FLAT RATE TAXES ============
    const cryptoTax = num(cryptoGains) * Y.flatRates.crypto;

    const totalTax = pit + totalSDC + cryptoTax + foreignPensionFlatTax + cyprusPensionFlatTax;
    const totalContributions = totalSI + totalGHS;
    const totalLiability = totalTax + totalContributions;

    // ============ TOTAL GROSS INCOME (for net calc) ============
    const totalGrossIncome = grossEmployment + grossSelfEmp + grossRent + foreignPension + cyprusPension + otherInc +
                             effectiveDividend + effectiveInterest + num(cryptoGains) +
                             royaltyQualifying + royaltyOrdinary + courtOrder + goodwill + cryptoMining;
    const netIncome = totalGrossIncome - totalLiability;
    const effectiveRate = totalGrossIncome > 0 ? (totalLiability / totalGrossIncome) * 100 : 0;

    // ============ CAPITAL GAINS (DISPLAY ONLY) ============
    const capGainsSharesAmount = num(capitalGainsShares);
    const capGainsPropertyAmount = num(capitalGainsProperty);

    return {
      year: yearKey, Y,
      grossEmployment, grossSelfEmp, grossRent, rentNet, foreignPension, otherInc,
      employmentInRepublic, employmentOutsideRepublic, employmentBik, employmentTaxWithheld, employmentGhsWithheld,
      lifeRedemptionAddback, innovativeAllowed, innovativeClaimRaw,
      cyprusPension, cyprusPensionFlatTax, cyprusPensionAddedToProgressive,
      royaltyQualifying, royaltyOrdinary, royaltyExempt, royaltyTaxable,
      courtOrder, goodwill, cryptoMining,
      foreignPensionFlatTax, foreignPensionAddedToProgressive,
      exemptIncome, reliefName, employmentAfterFirstExemption,
      ninetyDayExempt, ninetyDayApplied, daysAbroad, totalDays,
      employmentAfterAllExemptions, totalProgressiveIncome,
      empSi, empGhs, seSi, seGhs, passiveGhs: passiveGhs + passiveGhsAddl, totalSI, totalGHS,
      ownSI_GHS, cappedOptional, donationsAllowed, subscriptionsAllowed,
      capAllowancesAllowed, badDebtsAllowed, disabilityAllowed,
      pensionAllowed, medicalAllowed, lifeAllowed,
      lossesUsed, totalDeductions,
      childAllowance, studentAllowance, housingAllowance, greenAllowance, homeInsAllowance,
      total2026Allowances, eligibleFamily, familyThreshold,
      chargeableIncome, pit, bandBreakdown,
      sdcDividends, sdcInterest, sdcRental, totalSDC, cryptoTax,
      totalTax, totalContributions, totalLiability, totalGrossIncome, netIncome, effectiveRate,
      capGainsSharesAmount, capGainsPropertyAmount,
      taxResident, residencyRule, firstEmployment, hasDisability, hasDisabledDependant, isOver65, effectiveOver65, ageAtYearEnd,
    };
  }, [employments, pensions, rentalProperties, interestSources, dividendSources, lifeRedemptions,
      lifeSiPensionFunds, innovativeInvestments, selfEmployedActivities, partnerships,
      disposalGainImmovable, disposalLossImmovable, disposalGainShares, disposalLossShares,
      disposalTicOfCompany, disposalCountry,
      selfEmpTurnoverUnder70k, selfEmpAuditedAccounts,
      selfEmpIncome,
      otherIncome, dividendIncome, interestIncome, cryptoGains,
      foreignReliefType, isNonDom, pensionContrib, medicalContrib, lifeInsurance, lifeSumAssured,
      donations, profSubscriptions, lossesCarriedForward, numChildren, numStudents,
      mortgageOrRent, greenSpend, homeInsurance,
      taxResident, residencyRule, firstEmployment, hasDisability, hasDisabledDependant, isOver65, clientDOB,
      royaltyIncomeQualifying, royaltyIncomeOrdinary, courtOrderIncome, tradingGoodwill,
      capitalGainsShares, capitalGainsProperty, capitalGainsCryptoMining,
      daysWorkedAbroad, totalWorkDays, foreignEmployer,
      capitalAllowances, badDebts, disabilityAllowance,
      tradeUnionContrib, politicalPartyDonations, broaderPublicSectorReduction, communityOfficerExpenses]);

  const results2025 = useMemo(() => calculate(2025), [calculate]);
  const results2026 = useMemo(() => calculate(2026), [calculate]);
  const activeResults = selectedYear === 2025 ? results2025 : results2026;
  const Y = TAX_YEARS[selectedYear];

  const delta = results2026.netIncome - results2025.netIncome;
  const deltaPct = results2025.netIncome > 0 ? (delta / results2025.netIncome) * 100 : 0;

  // ============ SAVE TO PORTAL (optional — only when onSave is provided) ============
  const getInputState = () => ({
    selectedYear,
    clientName, clientTIC, clientID, clientDOB, clientSSN, clientAddress,
    employments, pensions, rentalProperties, interestSources, dividendSources, lifeRedemptions,
    lifeSiPensionFunds, innovativeInvestments, selfEmployedActivities, partnerships,
    disposalGainImmovable, disposalLossImmovable, disposalGainShares, disposalLossShares,
    disposalTicOfCompany, disposalCountry,
    selfEmpTurnoverUnder70k, selfEmpAuditedAccounts,
    selfEmpIncome,
    otherIncome, dividendIncome, interestIncome, cryptoGains,
    foreignReliefType, isNonDom,
    pensionContrib, medicalContrib, lifeInsurance, lifeSumAssured,
    donations, profSubscriptions, lossesCarriedForward,
    tradeUnionContrib, politicalPartyDonations, broaderPublicSectorReduction, communityOfficerExpenses,
    numChildren, numStudents,
    mortgageOrRent, greenSpend, homeInsurance,
    taxResident, residencyRule, firstEmployment, hasDisability, hasDisabledDependant, isOver65,
    royaltyIncomeQualifying, royaltyIncomeOrdinary,
    courtOrderIncome, tradingGoodwill,
    capitalGainsShares, capitalGainsProperty, capitalGainsCryptoMining,
    daysWorkedAbroad, totalWorkDays, foreignEmployer,
    capitalAllowances, badDebts, disabilityAllowance,
  });
  const handleSave = async () => {
    if (!onSave) return;
    setSaveStatus('saving');
    try {
      await onSave(getInputState(), { year: selectedYear, results: activeResults });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Tax return save failed:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // ============ CSV EXPORT ============
  const handleDownloadCSV = () => {
    const r = activeResults;
    const Y = TAX_YEARS[selectedYear];
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const refNum = `PCC-${selectedYear}-${Date.now().toString().slice(-6)}`;

    // CSV escape helper
    const esc = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const formatAmount = (val) => (val || 0).toFixed(2);

    // Build CSV rows
    const rows = [];

    // Header
    rows.push(['PC Prime & Calculate Consultants Ltd']);
    rows.push(['Personal Tax Computation']);
    rows.push([`Tax Year ${selectedYear} (Cyprus)`]);
    rows.push([]);
    rows.push(['Date Prepared', today]);
    rows.push(['Reference', refNum]);
    rows.push(['Status', 'Indicative']);
    rows.push([]);

    // Client details
    rows.push(['CLIENT DETAILS']);
    rows.push(['Name', clientName || 'Not provided']);
    rows.push(['TIC', clientTIC || 'Not provided']);
    rows.push(['ID No', clientID || 'Not provided']);
    rows.push(['DOB', clientDOB ? new Date(clientDOB).toLocaleDateString('en-GB') : 'Not provided']);
    rows.push(['SI No', clientSSN || 'Not provided']);
    rows.push(['Address', clientAddress || 'Not provided']);
    rows.push([]);

    // Part A - Income
    rows.push(['PART A - INCOME', 'Amount (EUR)']);
    if (r.grossEmployment > 0) rows.push(['Employment income (incl. BIK)', formatAmount(r.grossEmployment)]);
    if (r.exemptIncome > 0) rows.push([`Less: ${r.reliefName}`, `-${formatAmount(r.exemptIncome)}`]);
    if (r.grossSelfEmp > 0) rows.push(['Self-employment income', formatAmount(r.grossSelfEmp)]);
    if (r.grossRent > 0) {
      rows.push(['Rental income (gross)', formatAmount(r.grossRent)]);
      rows.push(['Less: 20% wear & tear + interest', `-${formatAmount(r.grossRent - r.rentNet)}`]);
    }
    if (r.foreignPensionAddedToProgressive > 0) rows.push(['Foreign pension (progressive)', formatAmount(r.foreignPensionAddedToProgressive)]);
    if (r.otherInc > 0) rows.push(['Other taxable income', formatAmount(r.otherInc)]);
    rows.push(['Total Income for Progressive PIT', formatAmount(r.totalProgressiveIncome)]);
    rows.push([]);

    // Part B - Deductions
    if (r.totalDeductions > 0) {
      rows.push(['PART B - ALLOWABLE DEDUCTIONS', 'Amount (EUR)']);
      if (r.totalSI > 0) rows.push(['Social Insurance contributions', `-${formatAmount(r.totalSI)}`]);
      if (r.totalGHS > 0) rows.push(['GHS / GeSY contributions', `-${formatAmount(r.totalGHS)}`]);
      if (r.cappedOptional > 0) rows.push(['Pension/Medical/Life (capped)', `-${formatAmount(r.cappedOptional)}`]);
      if (r.donationsAllowed > 0) rows.push(['Donations to approved charities', `-${formatAmount(r.donationsAllowed)}`]);
      if (r.subscriptionsAllowed > 0) rows.push(['Professional subscriptions', `-${formatAmount(r.subscriptionsAllowed)}`]);
      if (r.lossesUsed > 0) rows.push(['Losses brought forward', `-${formatAmount(r.lossesUsed)}`]);
      if (r.total2026Allowances > 0) rows.push(['2026 family/housing/green allowances', `-${formatAmount(r.total2026Allowances)}`]);
      rows.push(['Total Deductions', `-${formatAmount(r.totalDeductions + r.lossesUsed + r.total2026Allowances)}`]);
      rows.push([]);
    }

    // Chargeable income
    rows.push(['CHARGEABLE INCOME', formatAmount(r.chargeableIncome)]);
    rows.push([]);

    // PIT bands
    if (r.bandBreakdown.length > 0) {
      rows.push(['PART C - INCOME TAX (PROGRESSIVE BANDS)', 'Amount (EUR)']);
      r.bandBreakdown.forEach(b => {
        rows.push([`${b.range} @ ${(b.rate * 100).toFixed(0)}% on ${formatAmount(b.taxable)}`, formatAmount(b.tax)]);
      });
      rows.push(['Personal Income Tax (PIT)', formatAmount(r.pit)]);
      rows.push([]);
    }

    // SDC
    if (r.totalSDC > 0) {
      rows.push(['PART D - SPECIAL DEFENCE CONTRIBUTION', 'Amount (EUR)']);
      if (r.sdcDividends > 0) rows.push([`Dividends @ ${(Y.sdcRates.dividends * 100).toFixed(0)}%`, formatAmount(r.sdcDividends)]);
      if (r.sdcInterest > 0) rows.push([`Interest @ ${(Y.sdcRates.interest * 100).toFixed(0)}%`, formatAmount(r.sdcInterest)]);
      if (r.sdcRental > 0) rows.push(['Rental @ 2.25%', formatAmount(r.sdcRental)]);
      rows.push(['Total SDC', formatAmount(r.totalSDC)]);
      rows.push([]);
    }

    // Summary
    rows.push(['SUMMARY OF LIABILITY', 'Amount (EUR)']);
    rows.push(['Personal Income Tax (PIT)', formatAmount(r.pit)]);
    if (r.totalSDC > 0) rows.push(['Special Defence Contribution', formatAmount(r.totalSDC)]);
    if (r.cryptoTax > 0) rows.push(['Crypto tax (8% flat)', formatAmount(r.cryptoTax)]);
    if (r.foreignPensionFlatTax > 0) rows.push(['Foreign pension (5% flat)', formatAmount(r.foreignPensionFlatTax)]);
    rows.push(['Social Insurance contributions', formatAmount(r.totalSI)]);
    rows.push(['GHS / GeSY contributions', formatAmount(r.totalGHS)]);
    rows.push(['TOTAL LIABILITY', formatAmount(r.totalLiability)]);
    rows.push([]);
    rows.push(['Total Gross Income', formatAmount(r.totalGrossIncome)]);
    rows.push(['NET TAKE-HOME', formatAmount(r.netIncome)]);
    rows.push(['Effective Tax Rate (%)', r.effectiveRate.toFixed(2)]);
    rows.push(['Monthly Net Equivalent', formatAmount(r.netIncome / 12)]);
    rows.push([]);
    rows.push(['Disclaimer', 'Indicative computation only. Verify against official Cyprus Tax Department guidance before formal filing.']);
    rows.push(['Prepared by', 'PC Prime & Calculate Consultants Ltd']);

    // Convert to CSV string
    const csvContent = rows.map(row => row.map(esc).join(',')).join('\r\n');

    // Add UTF-8 BOM for Excel to recognize Greek/special characters correctly
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = clientName ? clientName.replace(/[^a-z0-9]/gi, '_') : 'Client';
    a.download = `Tax_Computation_${safeName}_${selectedYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  };

  // ============ EMAIL TO CLIENT ============
  const handleEmailClient = async () => {
    const r = activeResults;
    const refNum = `PCC-${selectedYear}-${Date.now().toString().slice(-6)}`;
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    // Ask for the recipient — we don't have client.email in clientPrefill yet.
    // Pre-fill the prompt with whatever's in clientPrefill if we ever add it.
    const recipientInput = window.prompt(
      `Send the ${selectedYear} tax computation PDF to which email address?`,
      (clientPrefill && clientPrefill.email) || ''
    );
    if (recipientInput === null) { setShowExportDialog(false); return; }
    const recipient = recipientInput.trim();
    if (!recipient) { alert('Recipient email is required.'); return; }

    const subject = `Tax Computation - ${selectedYear} - ${clientName || 'Client'}`;

    const body = `Dear ${clientName || '[Client Name]'},

Please find attached your Personal Tax Computation for tax year ${selectedYear}.

SUMMARY OF LIABILITY (${selectedYear})
=========================================
Total Gross Income:           ${fmt(r.totalGrossIncome)}
Personal Income Tax (PIT):    ${fmt(r.pit)}${r.totalSDC > 0 ? `
Special Defence Contribution: ${fmt(r.totalSDC)}` : ''}
Social Insurance:             ${fmt(r.totalSI)}
GHS / GeSY:                   ${fmt(r.totalGHS)}

TOTAL LIABILITY:              ${fmt(r.totalLiability)}
Net Take-Home:                ${fmt(r.netIncome)}
Effective Tax Rate:           ${r.effectiveRate.toFixed(2)}%

Reference: ${refNum}
Prepared: ${today}

Important: This computation is indicative only and does not constitute a formal tax return. Please review the attached PDF and contact us with any questions before formal filing through TAXISnet / TAX FOR ALL (TFA).

I am available to discuss this further at your convenience.

Kind regards,

Panayiotis Savvas
(unsigned) electronic transmission
Professional Accountant (SA)
m: +357 96 332 274
e: panayiotis@primeandcalculate.com

CONFIDENTIALITY NOTICE: This email and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this message and any attachments from your system. Any unauthorized use, disclosure, or distribution is prohibited.

---
Sent via the PC Prime client portal — connected to my email account.`;

    setShowExportDialog(false);
    try {
      const pdf = await generatePDF(activeResults, selectedYear, 'arraybuffer');
      if (!pdf) return; // generatePDF already alerted
      // Lazy import so this file doesn't have a hard dep on api.ts at parse time
      // (kept consistent with how the rest of the calc loads pieces).
      const { api } = await import('../services/api');
      await api.sendViaOutlook({
        from_firm: true,
        to: recipient,
        subject,
        body,
        attachments: [{ filename: pdf.filename, contentBase64: pdf.base64, contentType: 'application/pdf' }],
      });
      alert(`Tax computation sent to ${recipient}.`);
    } catch (err) {
      alert('Email failed: ' + (err.message || String(err)) + '\n\nCheck your settings at /settings/email — make sure your email account is connected.');
    }
  };

  // ============ PDF GENERATION USING jsPDF ============
  // jsPDF is bundled via the npm package (see package.json) — no CDN load.
  // mode 'save' (default) downloads the file; mode 'arraybuffer' returns
  // { filename, arraybuffer, base64 } so the caller can attach it to an email.
  const generatePDF = async (results, year, mode = 'save') => {
    try {
      // Initialize A4 portrait PDF (units in mm)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });
      registerRobotoFont(doc); // Greek-capable font for client/payer names
      doc.setFont('Roboto', 'normal'); // default font for the whole document

      // ============ CONSTANTS ============
      const PAGE_WIDTH = 210;
      const PAGE_HEIGHT = 297;
      const MARGIN_L = 15;
      const MARGIN_R = 15;
      const MARGIN_T = 15;
      const MARGIN_B = 15;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_L - MARGIN_R; // 180mm
      const RIGHT_EDGE = PAGE_WIDTH - MARGIN_R;

      // Brand colors (RGB)
      const COLOR_NAVY = [26, 54, 93];        // #1a365d
      const COLOR_GOLD = [155, 134, 31];      // #9b861f
      const COLOR_DARK_BG = [10, 22, 40];     // #0a1628
      const COLOR_TEXT = [26, 26, 26];        // #1a1a1a
      const COLOR_MUTED = [90, 100, 120];     // #5a6478
      const COLOR_LIGHT_BG = [248, 246, 240]; // #f8f6f0
      const COLOR_BORDER = [228, 226, 218];   // light grid line

      const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      const refNum = `PCC-${year}-${Date.now().toString().slice(-6)}`;
      const Y = TAX_YEARS[year];

      // Cursor position tracker
      let cursorY = MARGIN_T;
      let pageNum = 1;
      let totalPages = 1; // Will update if we add pages

      // ============ HELPER FUNCTIONS ============
      const fmtPDF = (val) => {
        if (val === undefined || val === null || isNaN(val) || val === 0) return '€0.00';
        return new Intl.NumberFormat('en-EU', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
      };

      const setColor = (rgb, type = 'text') => {
        if (type === 'text') doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        else if (type === 'fill') doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        else if (type === 'draw') doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
      };

      // Check if we need a new page; returns true if page added
      const checkPageBreak = (neededHeight) => {
        if (cursorY + neededHeight > PAGE_HEIGHT - MARGIN_B - 10) {
          doc.addPage();
          pageNum++;
          totalPages = pageNum;
          cursorY = MARGIN_T;
          drawHeader(true); // Draw simplified header on continuation pages
          return true;
        }
        return false;
      };

      // ============ DRAW HEADER ============
      const drawHeader = (isContinuation = false) => {
        if (isContinuation) {
          // Simplified header on continuation pages
          setColor(COLOR_GOLD, 'text');
          doc.setFont('Roboto', 'bold');
          doc.setFontSize(8);
          doc.text('PC Prime & Calculate Consultants Ltd', MARGIN_L, cursorY);
          setColor(COLOR_MUTED, 'text');
          doc.setFont('Roboto', 'normal');
          doc.text(`Tax Computation ${year} (cont.) · Ref: ${refNum}`, RIGHT_EDGE, cursorY, { align: 'right' });
          cursorY += 4;
          // Gold separator
          setColor(COLOR_GOLD, 'draw');
          doc.setLineWidth(0.5);
          doc.line(MARGIN_L, cursorY, RIGHT_EDGE, cursorY);
          cursorY += 8;
        } else {
          // Full header on first page

          // Logo (left side) - using PNG image
          const logoHeight = 24; // 24mm tall (enlarged)
          const logoAspectRatio = 2868 / 1026; // From our generated PNG
          const logoWidth = logoHeight * logoAspectRatio; // ~67mm

          try {
            doc.addImage(FIRM_LOGO, 'PNG', MARGIN_L, cursorY, logoWidth, logoHeight);
          } catch (e) {
            // Fallback: text logo if image fails
            setColor(COLOR_NAVY, 'text');
            doc.setFont('Roboto', 'bold');
            doc.setFontSize(14);
            doc.text('PC Prime & Calculate', MARGIN_L, cursorY + 8);
            setColor(COLOR_GOLD, 'text');
            doc.setFontSize(9);
            doc.text('Consultants Ltd', MARGIN_L, cursorY + 14);
          }

          // Contact details (right side) - aligned with larger logo
          setColor(COLOR_NAVY, 'text');
          doc.setFont('Roboto', 'bold');
          doc.setFontSize(10);
          doc.text('Panayiotis Savvas', RIGHT_EDGE, cursorY + 7, { align: 'right' });

          setColor(COLOR_GOLD, 'text');
          doc.setFont('Roboto', 'italic');
          doc.setFontSize(8);
          doc.text('Professional Accountant (SA)', RIGHT_EDGE, cursorY + 11.5, { align: 'right' });

          setColor(COLOR_MUTED, 'text');
          doc.setFont('Roboto', 'normal');
          doc.setFontSize(8);
          doc.text('m: +357 96 332 274', RIGHT_EDGE, cursorY + 16, { align: 'right' });
          doc.text('e: panayiotis@primeandcalculate.com', RIGHT_EDGE, cursorY + 19.5, { align: 'right' });

          cursorY += logoHeight + 4;

          // Gold separator line
          setColor(COLOR_GOLD, 'draw');
          doc.setLineWidth(0.6);
          doc.line(MARGIN_L, cursorY, RIGHT_EDGE, cursorY);
          cursorY += 8;
        }
      };

      // ============ DRAW DOCUMENT TITLE ============
      const drawTitle = () => {
        setColor(COLOR_TEXT, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(15);
        doc.text('PERSONAL TAX COMPUTATION', PAGE_WIDTH / 2, cursorY, { align: 'center' });
        cursorY += 6;

        setColor(COLOR_GOLD, 'text');
        doc.setFont('Roboto', 'italic');
        doc.setFontSize(10);
        doc.text(`Cyprus — Tax Year ${year}`, PAGE_WIDTH / 2, cursorY, { align: 'center' });
        cursorY += 8;
      };

      // ============ DRAW META BAR ============
      const drawMeta = () => {
        const boxHeight = 11;
        setColor(COLOR_LIGHT_BG, 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, boxHeight, 'F');

        // Left gold accent stripe
        setColor(COLOR_GOLD, 'fill');
        doc.rect(MARGIN_L, cursorY, 1.5, boxHeight, 'F');

        const cols = [
          { label: 'DATE PREPARED', value: today },
          { label: 'REFERENCE', value: refNum },
          { label: 'TAX YEAR', value: String(year) },
          { label: 'STATUS', value: 'Indicative' },
        ];

        const colWidth = (CONTENT_WIDTH - 5) / cols.length;
        cols.forEach((col, i) => {
          const x = MARGIN_L + 5 + (i * colWidth);
          setColor(COLOR_MUTED, 'text');
          doc.setFont('Roboto', 'normal');
          doc.setFontSize(6.5);
          doc.text(col.label, x, cursorY + 4);

          setColor(COLOR_NAVY, 'text');
          doc.setFont('Roboto', 'bold');
          doc.setFontSize(8.5);
          doc.text(col.value, x, cursorY + 8.5);
        });

        cursorY += boxHeight + 5;
      };

      // ============ DRAW CLIENT BOX ============
      const drawClientBox = () => {
        const boxHeight = 24;
        setColor(COLOR_BORDER, 'draw');
        doc.setLineWidth(0.2);
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, boxHeight, 'S');

        setColor(COLOR_GOLD, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(7);
        doc.text('CLIENT DETAILS', MARGIN_L + 4, cursorY + 4);

        const drawField = (label, value, x, y) => {
          setColor(COLOR_MUTED, 'text');
          doc.setFont('Roboto', 'normal');
          doc.setFontSize(8);
          doc.text(label, x, y);

          if (value && value.trim()) {
            setColor(COLOR_NAVY, 'text');
            doc.setFont('Roboto', 'bold');
          } else {
            setColor([184, 189, 199], 'text');
            doc.setFont('Roboto', 'italic');
          }
          doc.setFontSize(8);
          doc.text(value && value.trim() ? value : 'Not provided', x + 18, y);
        };

        const dobDisplay = clientDOB ? new Date(clientDOB).toLocaleDateString('en-GB') : '';
        const colLeft = MARGIN_L + 4;
        const colRight = MARGIN_L + (CONTENT_WIDTH / 2) + 4;
        drawField('Name:', clientName, colLeft, cursorY + 9);
        drawField('ID No:', clientID, colLeft, cursorY + 14.5);
        drawField('DOB:', dobDisplay, colLeft, cursorY + 20);
        drawField('TIC:', clientTIC, colRight, cursorY + 9);
        drawField('Address:', clientAddress, colRight, cursorY + 14.5);
        drawField('SI No:', clientSSN, colRight, cursorY + 20);

        cursorY += boxHeight + 6;
      };

      // ============ DRAW SECTION HEADER ============
      const drawSectionHeader = (text) => {
        checkPageBreak(8);
        setColor(COLOR_GOLD, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(8.5);
        doc.text(text, MARGIN_L, cursorY);

        setColor(COLOR_GOLD, 'draw');
        doc.setLineWidth(0.4);
        doc.line(MARGIN_L, cursorY + 1.5, RIGHT_EDGE, cursorY + 1.5);
        cursorY += 5;
      };

      // ============ DRAW TABLE ROW ============
      const drawRow = (label, value, opts = {}) => {
        const { indent = 0, bold = false, italic = false, color = COLOR_TEXT, valueColor = null, lineAbove = false, lineBelow = true, fontSize = 9, padding = 1 } = opts;

        checkPageBreak(fontSize * 0.5 + padding * 2 + 2);

        if (lineAbove) {
          setColor(COLOR_NAVY, 'draw');
          doc.setLineWidth(0.4);
          doc.line(MARGIN_L, cursorY - 0.5, RIGHT_EDGE, cursorY - 0.5);
        }

        cursorY += padding + 1;

        setColor(color, 'text');
        if (bold) doc.setFont('Roboto', 'bold');
        else if (italic) doc.setFont('Roboto', 'italic');
        else doc.setFont('Roboto', 'normal');
        doc.setFontSize(fontSize);

        const labelX = MARGIN_L + (indent * 4);
        doc.text(label, labelX, cursorY);

        if (value !== null && value !== undefined && value !== '') {
          setColor(valueColor || color, 'text');
          if (bold) doc.setFont('Roboto', 'bold');
          else doc.setFont('Roboto', 'normal');
          doc.text(value, RIGHT_EDGE, cursorY, { align: 'right' });
        }

        cursorY += padding + 1;

        if (lineBelow) {
          setColor(COLOR_BORDER, 'draw');
          doc.setLineWidth(0.1);
          doc.line(MARGIN_L, cursorY, RIGHT_EDGE, cursorY);
        }
      };

      // ============ DRAW HIGHLIGHTED ROW ============
      const drawHighlightRow = (label, value) => {
        checkPageBreak(10);
        cursorY += 1;
        // Top and bottom border (navy)
        setColor(COLOR_NAVY, 'draw');
        doc.setLineWidth(0.6);
        doc.line(MARGIN_L, cursorY, RIGHT_EDGE, cursorY);

        // Light bg
        setColor(COLOR_LIGHT_BG, 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, 7, 'F');

        cursorY += 5;
        setColor(COLOR_NAVY, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(10);
        doc.text(label, MARGIN_L + 2, cursorY);
        doc.text(value, RIGHT_EDGE - 2, cursorY, { align: 'right' });
        cursorY += 2;

        setColor(COLOR_NAVY, 'draw');
        doc.setLineWidth(0.6);
        doc.line(MARGIN_L, cursorY, RIGHT_EDGE, cursorY);
        cursorY += 6;
      };

      // ============ DRAW SUMMARY BOX (DARK) ============
      const drawSummaryBox = () => {
        const rows = [
          ['Personal Income Tax (PIT)', fmtPDF(results.pit)],
        ];
        if (results.totalSDC > 0) rows.push(['Special Defence Contribution', fmtPDF(results.totalSDC)]);
        if (results.cryptoTax > 0) rows.push(['Crypto tax (8% flat)', fmtPDF(results.cryptoTax)]);
        if (results.foreignPensionFlatTax > 0) rows.push(['Foreign pension (5% flat)', fmtPDF(results.foreignPensionFlatTax)]);
        rows.push(['Social Insurance contributions', fmtPDF(results.totalSI)]);
        rows.push(['GHS / GeSY contributions', fmtPDF(results.totalGHS)]);

        const titleH = 6;
        const rowH = 4.5;
        const finalRowH = 8;
        const padding = 3;
        const boxHeight = padding + titleH + (rows.length * rowH) + finalRowH + padding;

        checkPageBreak(boxHeight + 2);

        // Dark navy background
        setColor(COLOR_DARK_BG, 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, boxHeight, 'F');

        // Gold border
        setColor(COLOR_GOLD, 'draw');
        doc.setLineWidth(0.5);
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, boxHeight, 'S');

        let innerY = cursorY + padding + 4;

        // Title
        setColor(COLOR_GOLD, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(7.5);
        doc.text('SUMMARY OF LIABILITY', PAGE_WIDTH / 2, innerY, { align: 'center' });
        innerY += titleH;

        // Rows
        setColor([232, 230, 224], 'text'); // Cream text on dark
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(9);
        rows.forEach(([label, value]) => {
          doc.text(label, MARGIN_L + 4, innerY);
          doc.text(value, RIGHT_EDGE - 4, innerY, { align: 'right' });
          innerY += rowH;
        });

        // Final row - TOTAL LIABILITY
        innerY += 1;
        setColor(COLOR_GOLD, 'draw');
        doc.setLineWidth(0.5);
        doc.line(MARGIN_L + 4, innerY, RIGHT_EDGE - 4, innerY);
        innerY += 4.5;

        setColor(COLOR_GOLD, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(11);
        doc.text('TOTAL LIABILITY', MARGIN_L + 4, innerY);
        doc.text(fmtPDF(results.totalLiability), RIGHT_EDGE - 4, innerY, { align: 'right' });

        cursorY += boxHeight + 4;
      };

      // ============ DRAW NET TAKE-HOME BOX ============
      const drawNetTakeHome = () => {
        const boxHeight = 22;
        checkPageBreak(boxHeight + 2);

        // Light bg with gold border
        setColor(COLOR_LIGHT_BG, 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, boxHeight, 'F');
        setColor(COLOR_GOLD, 'draw');
        doc.setLineWidth(0.6);
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, boxHeight, 'S');

        let innerY = cursorY + 5;
        setColor(COLOR_MUTED, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(7);
        doc.text('NET TAKE-HOME', PAGE_WIDTH / 2, innerY, { align: 'center' });
        innerY += 7;

        setColor(COLOR_GOLD, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(20);
        doc.text(fmtPDF(results.netIncome), PAGE_WIDTH / 2, innerY, { align: 'center' });
        innerY += 6;

        setColor(COLOR_MUTED, 'text');
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(8);
        doc.text(`Effective tax rate: ${results.effectiveRate.toFixed(2)}%   ·   Monthly equivalent: ${fmtPDF(results.netIncome / 12)}`, PAGE_WIDTH / 2, innerY, { align: 'center' });

        cursorY += boxHeight + 5;
      };

      // ============ DRAW FOOTER (CONFIDENTIALITY + DISCLAIMER) ============
      const drawSignatureBlock = () => {
        // Confidentiality notice box
        const confText = 'CONFIDENTIALITY NOTICE: This document and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this document and any attachments from your system. Any unauthorized use, disclosure, or distribution is prohibited.';

        // Pre-calculate height
        doc.setFontSize(6.5);
        const confLines = doc.splitTextToSize(confText, CONTENT_WIDTH - 8);
        const confBoxHeight = (confLines.length * 2.5) + 5;

        checkPageBreak(confBoxHeight + 10);

        // Light bg with gold accent
        setColor(COLOR_LIGHT_BG, 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_WIDTH, confBoxHeight, 'F');
        setColor(COLOR_GOLD, 'fill');
        doc.rect(MARGIN_L, cursorY, 1.5, confBoxHeight, 'F');

        // "CONFIDENTIALITY NOTICE:" label in navy
        setColor(COLOR_NAVY, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(7);
        doc.text('CONFIDENTIALITY NOTICE:', MARGIN_L + 4, cursorY + 4);

        // Body text
        setColor(COLOR_MUTED, 'text');
        doc.setFont('Roboto', 'italic');
        doc.setFontSize(6.5);
        const restOfText = 'This document and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this document and any attachments from your system. Any unauthorized use, disclosure, or distribution is prohibited.';
        const restLines = doc.splitTextToSize(restOfText, CONTENT_WIDTH - 8);
        doc.text(restLines, MARGIN_L + 4, cursorY + 7.5);

        cursorY += confBoxHeight + 4;

        // Disclaimer footer
        setColor(COLOR_GOLD, 'draw');
        doc.setLineWidth(0.3);
        doc.line(MARGIN_L, cursorY, RIGHT_EDGE, cursorY);
        cursorY += 3;

        setColor(COLOR_MUTED, 'text');
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(6.5);
        const disclaimer = `Disclaimer: This computation is indicative only, prepared based on data provided. It does not constitute a formal tax return and should not be filed as such with the Cyprus Tax Department. Verify all figures against original supporting documents before formal filing through TAXISnet / TAX FOR ALL (TFA). Individual circumstances may produce different results. This document does not constitute tax advice; consult your professional accountant for advice specific to your situation.   ·   Prepared by PC Prime & Calculate Consultants Ltd   ·   Reference: ${refNum}   ·   Generated: ${today}`;
        const disclaimerLines = doc.splitTextToSize(disclaimer, CONTENT_WIDTH);
        doc.text(disclaimerLines, MARGIN_L, cursorY + 2);
      };

      // ============ ADD PAGE NUMBERS (only if multi-page) ============
      const addPageNumbers = () => {
        if (totalPages > 1) {
          for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            setColor(COLOR_MUTED, 'text');
            doc.setFont('Roboto', 'normal');
            doc.setFontSize(7);
            doc.text(`Page ${i} of ${totalPages}`, RIGHT_EDGE, PAGE_HEIGHT - 8, { align: 'right' });
          }
        }
      };

      // ============ BUILD THE DOCUMENT ============
      drawHeader();
      drawTitle();
      drawMeta();
      drawClientBox();

      // Part A - Income
      drawSectionHeader('PART A — INCOME');
      if (results.grossEmployment > 0) drawRow('Employment income (incl. BIK)', fmtPDF(results.grossEmployment));
      if (results.exemptIncome > 0) drawRow(`Less: ${results.reliefName}`, `(${fmtPDF(results.exemptIncome)})`, { indent: 1, italic: true, color: COLOR_MUTED, fontSize: 8 });
      if (results.grossSelfEmp > 0) drawRow('Self-employment income', fmtPDF(results.grossSelfEmp));
      if (results.grossRent > 0) {
        drawRow('Rental income (gross)', fmtPDF(results.grossRent));
        drawRow('Less: 20% wear & tear + interest', `(${fmtPDF(results.grossRent - results.rentNet)})`, { indent: 1, italic: true, color: COLOR_MUTED, fontSize: 8 });
      }
      if (results.foreignPensionAddedToProgressive > 0) drawRow('Foreign pension (progressive election)', fmtPDF(results.foreignPensionAddedToProgressive));
      if (results.otherInc > 0) drawRow('Other taxable income', fmtPDF(results.otherInc));
      drawRow('Total Income for Progressive PIT', fmtPDF(results.totalProgressiveIncome), { bold: true });
      cursorY += 3;

      // Part B - Deductions
      if (results.totalDeductions > 0) {
        drawSectionHeader('PART B — ALLOWABLE DEDUCTIONS');
        if (results.totalSI > 0) drawRow('Social Insurance contributions', `(${fmtPDF(results.totalSI)})`, { indent: 1 });
        if (results.totalGHS > 0) drawRow('GHS / GeSY contributions', `(${fmtPDF(results.totalGHS)})`, { indent: 1 });
        if (results.cappedOptional > 0) drawRow('Pension / Medical / Life (capped)', `(${fmtPDF(results.cappedOptional)})`, { indent: 1 });
        if (results.donationsAllowed > 0) drawRow('Donations to approved charities', `(${fmtPDF(results.donationsAllowed)})`, { indent: 1 });
        if (results.subscriptionsAllowed > 0) drawRow('Professional subscriptions', `(${fmtPDF(results.subscriptionsAllowed)})`, { indent: 1 });
        if (results.lossesUsed > 0) drawRow('Losses brought forward', `(${fmtPDF(results.lossesUsed)})`, { indent: 1 });
        if (results.total2026Allowances > 0) drawRow('2026 family/housing/green allowances', `(${fmtPDF(results.total2026Allowances)})`, { indent: 1, valueColor: COLOR_GOLD });
        drawRow('Total Deductions', `(${fmtPDF(results.totalDeductions + results.lossesUsed + results.total2026Allowances)})`, { bold: true });
        cursorY += 3;
      }

      // Chargeable Income highlight
      drawHighlightRow('CHARGEABLE INCOME', fmtPDF(results.chargeableIncome));

      // Part C - PIT
      if (results.bandBreakdown.length > 0) {
        drawSectionHeader('PART C — INCOME TAX (PROGRESSIVE BANDS)');
        results.bandBreakdown.forEach(b => {
          drawRow(`${b.range} @ ${(b.rate * 100).toFixed(0)}% on ${fmtPDF(b.taxable)}`, fmtPDF(b.tax), { indent: 1, fontSize: 8.5 });
        });
        drawRow('Personal Income Tax (PIT)', fmtPDF(results.pit), { bold: true, valueColor: COLOR_GOLD });
        cursorY += 3;
      }

      // Part D - SDC
      if (results.totalSDC > 0) {
        drawSectionHeader('PART D — SPECIAL DEFENCE CONTRIBUTION');
        if (results.sdcDividends > 0) drawRow(`Dividends @ ${(Y.sdcRates.dividends * 100).toFixed(0)}%`, fmtPDF(results.sdcDividends), { indent: 1 });
        if (results.sdcInterest > 0) drawRow(`Interest @ ${(Y.sdcRates.interest * 100).toFixed(0)}%`, fmtPDF(results.sdcInterest), { indent: 1 });
        if (results.sdcRental > 0) drawRow('Rental @ 2.25%', fmtPDF(results.sdcRental), { indent: 1 });
        drawRow('Total SDC', fmtPDF(results.totalSDC), { bold: true });
        cursorY += 3;
      }

      // Summary box
      drawSummaryBox();

      // Net take-home
      drawNetTakeHome();

      // Signature + disclaimer
      drawSignatureBlock();

      // Add page numbers if multi-page
      addPageNumbers();

      // ============ DOWNLOAD or RETURN BYTES ============
      const safeName = clientName ? clientName.replace(/[^a-z0-9]/gi, '_') : 'Client';
      const filename = `Tax_Computation_${safeName}_${year}.pdf`;
      if (mode === 'arraybuffer') {
        const ab = doc.output('arraybuffer');
        // Chunked base64 to avoid call-stack overflow on large PDFs.
        const bytes = new Uint8Array(ab);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return { filename, base64: btoa(binary) };
      }
      doc.save(filename);
      return { filename };
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert(`PDF generation failed: ${err.message}\n\nPlease try again, or use the Print Preview option as fallback.`);
      return null;
    }
  };

  const handleDownloadPDF = () => {
    setShowExportDialog(false);
    generatePDF(activeResults, selectedYear);
  };

  // ============ TD1-FORMAT PDF (FILING LAYOUT) ============
  // Generates a form-style PDF that mirrors the official TD1 structure
  // (Parts 1, 2, 3, 4 with subsections, 5, 6). Branches on formType for
  // the Individuals vs Self-Employed variants. Not pixel-perfect — focused
  // on getting all data labelled with TD1 part / column references so it
  // can be cross-referenced with the official form when filing.
  const generateTd1Pdf = async (results, year) => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      registerRobotoFont(doc); // Greek-capable font for client/payer names
      doc.setFont('Roboto', 'normal'); // default font for the whole document
      const PAGE_W = 210, PAGE_H = 297;
      const MARGIN_L = 15, MARGIN_R = 15, MARGIN_T = 15, MARGIN_B = 15;
      const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
      const NAVY = [26, 54, 93];
      const GOLD = [155, 134, 31];
      const MUTED = [90, 100, 120];
      const BORDER = [200, 200, 200];
      const isSelfEmp = formType === 'self_employed';
      let cursorY = MARGIN_T;
      let pageNum = 1;

      const setColor = (rgb, type = 'text') => {
        if (type === 'text') doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        else if (type === 'draw') doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        else if (type === 'fill') doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      };
      const fmtAmt = (v) => (Number(v) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-GB') : '';

      const newPageIfNeeded = (needed) => {
        if (cursorY + needed > PAGE_H - MARGIN_B - 10) {
          // Page footer
          setColor(MUTED, 'text');
          doc.setFont('Roboto', 'normal');
          doc.setFontSize(7);
          doc.text(`Page ${pageNum}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
          doc.addPage();
          pageNum++;
          cursorY = MARGIN_T;
        }
      };

      const drawPartHeader = (label) => {
        newPageIfNeeded(14);
        setColor(NAVY, 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_W, 6, 'F');
        setColor([255, 255, 255], 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(9);
        doc.text(label, MARGIN_L + 2, cursorY + 4.2);
        cursorY += 8;
      };

      const drawSubHeader = (label) => {
        newPageIfNeeded(8);
        setColor(GOLD, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(8);
        doc.text(label, MARGIN_L, cursorY + 3);
        setColor(GOLD, 'draw');
        doc.setLineWidth(0.2);
        doc.line(MARGIN_L, cursorY + 4.5, MARGIN_L + CONTENT_W, cursorY + 4.5);
        cursorY += 6;
      };

      const drawField = (label, value, indent = 0) => {
        newPageIfNeeded(6);
        setColor(MUTED, 'text');
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(8);
        doc.text(label, MARGIN_L + indent, cursorY + 3);
        setColor(NAVY, 'text');
        doc.setFont('Roboto', 'bold');
        doc.text(String(value || '—'), MARGIN_L + 70, cursorY + 3);
        cursorY += 5;
      };

      const drawTable = (headers, rows, columnWidths) => {
        if (rows.length === 0) {
          setColor(MUTED, 'text');
          doc.setFont('Roboto', 'italic');
          doc.setFontSize(7.5);
          doc.text('(no rows)', MARGIN_L + 2, cursorY + 3);
          cursorY += 5;
          return;
        }
        const rowH = 5.5;
        newPageIfNeeded(rowH * (rows.length + 1) + 4);
        // Header
        setColor([240, 235, 215], 'fill');
        doc.rect(MARGIN_L, cursorY, CONTENT_W, rowH, 'F');
        setColor(NAVY, 'text');
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(7);
        let x = MARGIN_L + 1;
        headers.forEach((h, i) => {
          doc.text(String(h), x, cursorY + 3.6);
          x += columnWidths[i];
        });
        cursorY += rowH;
        // Rows
        setColor(NAVY, 'draw');
        doc.setLineWidth(0.1);
        setColor([26, 54, 93], 'text');
        doc.setFont('Roboto', 'normal');
        doc.setFontSize(7);
        rows.forEach(row => {
          newPageIfNeeded(rowH + 2);
          x = MARGIN_L + 1;
          row.forEach((cell, i) => {
            const text = String(cell || '');
            // Truncate long text to column width
            const maxChars = Math.max(8, Math.floor(columnWidths[i] / 1.6));
            const display = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
            doc.text(display, x, cursorY + 3.6);
            x += columnWidths[i];
          });
          setColor(BORDER, 'draw');
          doc.line(MARGIN_L, cursorY + rowH, MARGIN_L + CONTENT_W, cursorY + rowH);
          cursorY += rowH;
        });
        cursorY += 2;
      };

      // ============ HEADING ============
      setColor(NAVY, 'text');
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(11);
      doc.text('MINISTRY OF FINANCE — TAX DEPARTMENT', PAGE_W / 2, cursorY + 5, { align: 'center' });
      cursorY += 6;
      doc.setFontSize(12);
      doc.text(isSelfEmp ? 'DECLARATION OF INCOME — Self Employed' : 'DECLARATION OF INCOME — Individual', PAGE_W / 2, cursorY + 5, { align: 'center' });
      cursorY += 6;
      setColor(GOLD, 'text');
      doc.setFontSize(10);
      doc.text(`Tax Year ${year}`, PAGE_W / 2, cursorY + 5, { align: 'center' });
      cursorY += 10;
      setColor(MUTED, 'text');
      doc.setFont('Roboto', 'italic');
      doc.setFontSize(7);
      doc.text(`Prepared by PC Prime & Calculate Consultants Ltd · ${new Date().toLocaleDateString('en-GB')} · Form TD1 ${isSelfEmp ? '(self employed)' : ''} ${year}`, PAGE_W / 2, cursorY + 4, { align: 'center' });
      cursorY += 8;

      // ============ PART 1 — TAXPAYER'S DETAILS ============
      drawPartHeader("PART 1 — TAXPAYER'S DETAILS");
      drawField('Name / Business Name:', clientName);
      drawField('T.I.C.:', clientTIC);
      drawField('ID / Passport No.:', clientID);
      drawField('Date of Birth:', fmtDate(clientDOB));
      drawField('Social Insurance No.:', clientSSN);
      drawField('Address:', clientAddress);

      // ============ PART 3 — TAX RESIDENCE & GHS ============
      drawPartHeader('PART 3 — TAX RESIDENCE AND OTHER INFORMATION');
      drawField('Tax Resident of Cyprus:', taxResident ? `Yes (${residencyRule}-day rule)` : 'No');
      if (isSelfEmp) {
        drawSubHeader('Part 3.C — Books & Records');
        drawField('Turnover up to €70,000:', selfEmpTurnoverUnder70k ? 'YES' : 'NO');
        drawField('Audited / Inspected:', selfEmpAuditedAccounts === 'audited' ? 'Yes — audited' : selfEmpAuditedAccounts === 'inspected' ? 'Yes — inspected' : 'No');
      }

      // ============ PART 4 — INCOME ============
      drawPartHeader('PART 4 — INCOME');

      if (!isSelfEmp) {
        // Part 4.A — Salaried Services
        drawSubHeader('Part 4.A — Salaried Services');
        drawTable(
          ['T.I.C.', 'Employer', 'Code', 'Months', 'Gross In Rep.', 'Gross Outside', 'BIK', 'Tax W/h', 'GHS W/h'],
          employments.map(e => [
            e.employerTic, e.employerName, e.code, e.periodMonths,
            fmtAmt(e.grossInRepublic), fmtAmt(e.grossOutsideRepublic),
            fmtAmt(e.bik), fmtAmt(e.taxWithheld), fmtAmt(e.ghsWithheld),
          ]),
          [18, 32, 12, 14, 24, 24, 18, 20, 18]
        );
      } else {
        // Part 4.1 — Trade / Industry / Profession
        drawSubHeader('Part 4.1 — Trade / Industry / Profession / Vocation');
        drawTable(
          ['Activity', 'Occ. Cat.', 'In/Out Rep.', 'Profit C/Y', 'Loss C/Y', 'Loss BF 1997', 'Loss >5y', 'Tax Out'],
          selfEmployedActivities.map(a => [
            (SELF_EMP_ACTIVITY_TYPES.find(t => t.code === a.mainCategory) || {}).label || a.mainCategory,
            a.occupationalCategory,
            a.isOutsideRepublic ? 'Outside' : 'In Republic',
            fmtAmt(a.taxableProfit), fmtAmt(a.lossCurrentYear),
            fmtAmt(a.lossesBfFrom1997), fmtAmt(a.lossesMoreThan5yNotCarried),
            fmtAmt(a.taxPaidOutside),
          ]),
          [28, 16, 22, 22, 22, 22, 22, 22]
        );

        // Part 4.2 — Disposal
        drawSubHeader('Part 4.2 — Gain / (Loss) on Disposal of Immovable Property or Shares');
        drawField('Gain from Immovable Property:', `€${fmtAmt(disposalGainImmovable)}`);
        drawField('(Loss) Immovable Property:', `€${fmtAmt(disposalLossImmovable)}`);
        drawField('Gain from Shares (Private Co.):', `€${fmtAmt(disposalGainShares)}`);
        drawField('(Loss) Shares (Private Co.):', `€${fmtAmt(disposalLossShares)}`);
        drawField('T.I.C. of Company:', disposalTicOfCompany);
        drawField('Country of T.I.C.:', disposalCountry);

        // Part 4.3 — Partnerships
        drawSubHeader('Part 4.3 — Income from Partnership');
        drawTable(
          ['T.I.C.', 'Name', 'Code', '%', 'Salary', 'Int. Cap.', 'Trade', '(Loss)', 'Tax W/h'],
          partnerships.map(p => [
            p.tic, p.name, p.code, p.percentage,
            fmtAmt(p.salary), fmtAmt(p.interestOnCapital),
            fmtAmt(p.tradingIncome), fmtAmt(p.tradingLoss),
            fmtAmt(p.taxWithheld),
          ]),
          [18, 32, 10, 12, 20, 22, 22, 22, 22]
        );
      }

      // Part 4.B — Pensions
      drawSubHeader('Part 4.B — Pensions');
      drawTable(
        ['T.I.C.', 'Payer', 'Code', 'Amount', 'Tax W/h', 'GHS W/h'],
        pensions.map(p => [p.payerTic, p.payerName, p.code, fmtAmt(p.amount), fmtAmt(p.taxWithheld), fmtAmt(p.ghsWithheld)]),
        [22, 50, 16, 32, 30, 30]
      );

      // Part 4.C — Rents
      drawSubHeader('Part 4.C — Rents / Income from Immovable Property');
      drawTable(
        ['Reg. No.', 'Type', 'Lessee', 'Share %', 'Gross In', 'Gross Out', 'Cap. Allow.', 'Interest', 'SDC W/h', 'GHS W/h'],
        rentalProperties.map(r => [
          r.registrationNo, r.propertyTypeCode, r.lesseeName, r.ownershipShare,
          fmtAmt(r.annualGrossInRepublic), fmtAmt(r.annualGrossOutsideRepublic),
          fmtAmt(r.capitalAllowances), fmtAmt(r.interestPayable),
          fmtAmt(r.sdcWithheld), fmtAmt(r.ghsWithheld),
        ]),
        [22, 12, 26, 14, 20, 20, 20, 18, 14, 14]
      );

      // Part 4.E — Interest
      drawSubHeader('Part 4.E — Interest Receivable');
      drawTable(
        ['Code', 'T.I.C.', 'Debtor', 'Country', 'Gross', 'Tax Out', 'SDC W/h', 'GHS W/h'],
        interestSources.map(s => [s.code, s.debtorTic, s.debtorName, s.country, fmtAmt(s.grossInterest), fmtAmt(s.taxPaidOutside), fmtAmt(s.sdcWithheld), fmtAmt(s.ghsWithheld)]),
        [12, 20, 40, 22, 20, 20, 18, 28]
      );

      // Part 4.F — Dividends
      drawSubHeader('Part 4.F — Dividends');
      drawTable(
        ['Code', 'T.I.C.', 'Country', 'Business', 'Gross', 'SDC W/h', 'GHS W/h', 'Tax Out'],
        dividendSources.map(d => [d.code, d.payerTic, d.country, d.businessName, fmtAmt(d.grossDividend), fmtAmt(d.sdcWithheld), fmtAmt(d.ghsWithheld), fmtAmt(d.taxPaidOutside)]),
        [12, 20, 22, 36, 22, 18, 18, 32]
      );

      // Part 4.G — Life redemption (only when populated)
      if (lifeRedemptions.length > 0) {
        drawSubHeader('Part 4.G — Redemption of Life Insurance Policies');
        drawTable(
          ['T.I.C.', 'Company', 'Issued', 'Cancelled', 'Premiums Deducted'],
          lifeRedemptions.map(r => [r.insuranceCompanyTic, r.insuranceCompanyName, fmtDate(r.issueDate), fmtDate(r.cancellationDate), fmtAmt(r.premiumsDeducted)]),
          [22, 60, 30, 30, 38]
        );
        drawField('Add-back to income:', `€${fmtAmt(results.lifeRedemptionAddback)}`);
      }

      // ============ PART 5 — DEDUCTIONS ============
      drawPartHeader('PART 5 — DEDUCTIONS / ALLOWANCES');

      drawSubHeader('Part 5.A — Miscellaneous Deductions');
      drawField('1. Trade union contributions:', `€${fmtAmt(tradeUnionContrib)}`);
      drawField('2. Professional subscriptions:', `€${fmtAmt(profSubscriptions)}`);
      drawField('3. Donations to approved charities:', `€${fmtAmt(donations)}`);
      drawField('4. Broader public sector reductions:', `€${fmtAmt(broaderPublicSectorReduction)}`);
      drawField('5. Donations to political parties (max €50K):', `€${fmtAmt(politicalPartyDonations)}`);
      drawField('6. Community / Customs officer expenses:', `€${fmtAmt(communityOfficerExpenses)}`);

      // Part 5.B — Innovative business investments
      if (innovativeInvestments.length > 0) {
        drawSubHeader('Part 5.B — Investment in Innovative Businesses');
        drawTable(
          ['T.I.C.', 'Code', 'Year Inv.', 'Yr Cont.', 'Initial', 'Claimed ≤2023', 'Claim This Yr'],
          innovativeInvestments.map(r => [r.tic, r.code, r.yearOfInvestment, r.yearOfContinuationInvestment, fmtAmt(r.initialAmount), fmtAmt(r.amountClaimedUpTo2023), fmtAmt(r.amountToClaim)]),
          [22, 12, 22, 22, 28, 32, 42]
        );
        drawField('Allowed (capped 50% post-deduction):', `€${fmtAmt(results.innovativeAllowed)}`);
      }

      // Part 5.C — Life / SI / Pension funds
      drawSubHeader('Part 5.C — Life / Social Insurance / Pension Funds');
      drawTable(
        ['T.I.C.', 'Fund / Insurer', 'Code', 'Life of', 'Sum Assured', 'Amount Paid'],
        lifeSiPensionFunds.map(r => [r.fundTic, r.fundName, r.code, r.code === '3' ? r.lifeOf : '', fmtAmt(r.sumAssured), fmtAmt(r.amountPaid)]),
        [22, 50, 16, 18, 30, 44]
      );

      // ============ PART 6 — INCOME TAX COMPUTATION ============
      drawPartHeader('PART 6 — INCOME TAX COMPUTATION');
      drawField('Total Progressive Income:', `€${fmtAmt(results.totalProgressiveIncome)}`);
      drawField('Total Deductions:', `€${fmtAmt(results.totalDeductions)}`);
      if (results.innovativeAllowed > 0) drawField('Innovative Business Deduction:', `€${fmtAmt(results.innovativeAllowed)}`);
      drawField('Chargeable Income:', `€${fmtAmt(results.chargeableIncome)}`);
      cursorY += 2;
      drawField('Personal Income Tax (PIT):', `€${fmtAmt(results.pit)}`);
      drawField('Special Defence Contribution (SDC):', `€${fmtAmt(results.totalSDC)}`);
      drawField('Social Insurance Contribution:', `€${fmtAmt(results.totalSI)}`);
      drawField('GHS / GeSY Contribution:', `€${fmtAmt(results.totalGHS)}`);
      if (results.foreignPensionFlatTax > 0) drawField('Foreign Pension Flat Tax (5%):', `€${fmtAmt(results.foreignPensionFlatTax)}`);
      if (results.cyprusPensionFlatTax > 0) drawField("Widow's Pension Flat Tax (20%):", `€${fmtAmt(results.cyprusPensionFlatTax)}`);
      if (results.cryptoTax > 0) drawField('Crypto Disposal Tax (8%):', `€${fmtAmt(results.cryptoTax)}`);
      cursorY += 1;
      setColor(NAVY, 'fill');
      doc.rect(MARGIN_L, cursorY, CONTENT_W, 7, 'F');
      setColor([255, 255, 255], 'text');
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(9);
      doc.text('TOTAL LIABILITY:', MARGIN_L + 2, cursorY + 4.8);
      doc.text(`€${fmtAmt(results.totalLiability)}`, MARGIN_L + CONTENT_W - 2, cursorY + 4.8, { align: 'right' });
      cursorY += 10;

      // Final page footer
      setColor(MUTED, 'text');
      doc.setFont('Roboto', 'italic');
      doc.setFontSize(7);
      doc.text(`Page ${pageNum}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
      doc.text('Indicative TD1 filing draft — verify against official Cyprus Tax Department forms before submission.', PAGE_W / 2, PAGE_H - 4, { align: 'center' });

      const safeName = clientName ? clientName.replace(/[^a-z0-9]/gi, '_') : 'Client';
      doc.save(`TD1_${isSelfEmp ? 'SelfEmployed' : 'Individual'}_${safeName}_${year}.pdf`);
    } catch (err) {
      console.error('TD1 PDF failed:', err);
      alert(`TD1 PDF generation failed: ${err.message}`);
    }
  };
  const handleDownloadTd1Pdf = () => {
    setShowExportDialog(false);
    generateTd1Pdf(activeResults, selectedYear);
  };

  const [xmlBusy, setXmlBusy] = useState(false);
  const handleDownloadTaxisnetXml = async () => {
    setShowExportDialog(false);
    const ft = formType === 'self_employed' ? 'self_employed' : 'individuals';
    const input = getInputState();
    let result;
    try {
      result = downloadTaxisnetXml(input, selectedYear, ft); // builds + triggers browser download
    } catch (err) {
      alert(`TaxisNet XML generation failed: ${err.message}`);
      return;
    }
    const noteBlock = result.warnings.length ? `\n\nNotes:\n• ${result.warnings.join('\n• ')}` : '';

    // Portal: also file the XML in the client's Documents folder for later import.
    if (onSaveXmlToClient) {
      const formCode = ft === 'self_employed' ? 'epr1a' : 'epr1m';
      const tic = String(input.clientTIC || 'taxpayer').trim() || 'taxpayer';
      const filename = `${formCode}-${tic}-${selectedYear}.xml`;
      setXmlBusy(true);
      try {
        await onSaveXmlToClient(result.xml, filename);
        alert(`TaxisNet XML downloaded and saved to the client's Documents folder as "${filename}".${noteBlock}`);
      } catch (err) {
        alert(`XML downloaded, but saving to the client folder failed: ${err.message}`);
      } finally {
        setXmlBusy(false);
      }
    } else if (result.warnings.length) {
      alert(`TaxisNet XML generated with notes:${noteBlock}`);
    }
  };

  const handlePrintPreview = () => {
    // Simple HTML preview for those who prefer browser print
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const refNum = `PCC-${selectedYear}-${Date.now().toString().slice(-6)}`;
    const Y = TAX_YEARS[selectedYear];
    const r = activeResults;
    const clientLine = (label, val) => `<tr><td style="color:#5a6478;width:80px;padding:2px 0">${label}</td><td style="font-weight:600;color:#1a365d">${val || '<i style="color:#b8bdc7;font-weight:normal">Not provided</i>'}</td></tr>`;

    const html = `<!DOCTYPE html><html><head><title>Tax Computation ${selectedYear}</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 9pt; line-height: 1.4; margin: 0; padding: 0; }
.header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 2px solid #9b861f; margin-bottom: 10px; }
.contact { text-align: right; font-size: 8pt; color: #5a6478; }
.contact .name { font-weight: bold; color: #1a365d; font-size: 10pt; }
.contact .title { color: #9b861f; font-style: italic; font-size: 8pt; }
h1 { text-align: center; font-size: 14pt; margin: 8px 0 2px 0; }
h2 { text-align: center; color: #9b861f; font-style: italic; font-size: 10pt; font-weight: normal; margin: 0 0 10px 0; }
.meta { background: #f8f6f0; border-left: 3px solid #9b861f; padding: 6px 10px; display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 8pt; }
.meta-label { color: #5a6478; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.08em; }
.meta-value { font-weight: bold; color: #1a365d; }
.client-box { border: 1px solid #e4e2da; padding: 8px 10px; margin-bottom: 10px; }
.client-title { color: #9b861f; font-weight: bold; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
.section-title { color: #9b861f; font-weight: bold; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.1em; padding-bottom: 2px; border-bottom: 1px solid #9b861f; margin: 10px 0 4px 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 2px 0; border-bottom: 1px solid #f0ede4; }
td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.indent { padding-left: 12px; color: #5a6478; }
.bold td { font-weight: bold; color: #1a365d; padding: 4px 0; }
.highlight { background: #f8f6f0; border-top: 2px solid #1a365d; border-bottom: 2px solid #1a365d; }
.highlight td { padding: 6px 0; font-weight: bold; color: #1a365d; font-size: 10pt; }
.summary-box { background: #0a1628; color: #e8e6e0; border: 2px solid #9b861f; padding: 8px 12px; margin-top: 10px; }
.summary-title { text-align: center; color: #9b861f; font-weight: bold; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 6px; }
.summary-row { display: flex; justify-content: space-between; padding: 2px 0; }
.summary-row.final { border-top: 1.5px solid #9b861f; margin-top: 4px; padding-top: 4px; color: #9b861f; font-weight: bold; font-size: 11pt; }
.net-box { background: #f8f6f0; border: 2px solid #9b861f; text-align: center; padding: 10px; margin-top: 8px; }
.net-label { color: #5a6478; font-weight: bold; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.15em; }
.net-value { color: #9b861f; font-weight: bold; font-size: 20pt; margin: 2px 0; }
.net-meta { color: #5a6478; font-size: 8pt; }
.controls { position: fixed; top: 10px; right: 10px; background: #0a1628; padding: 10px; border-radius: 4px; }
.controls button { padding: 8px 16px; background: #9b861f; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; margin-right: 4px; }
@media print { .controls { display: none; } }
</style></head><body>
<div class="controls"><button onclick="window.print()">🖨 Print</button><button onclick="window.close()" style="background:transparent;border:1px solid #9b861f;color:#9b861f">Close</button></div>
<div class="header">
  <img src="${FIRM_LOGO}" style="height:80px" />
  <div class="contact"><div class="name">Panayiotis Savvas</div><div class="title">Professional Accountant (SA)</div><div>m: +357 96 332 274</div><div>e: panayiotis@primeandcalculate.com</div></div>
</div>
<h1>PERSONAL TAX COMPUTATION</h1><h2>Cyprus — Tax Year ${selectedYear}</h2>
<div class="meta">
  <div><div class="meta-label">Date Prepared</div><div class="meta-value">${today}</div></div>
  <div><div class="meta-label">Reference</div><div class="meta-value">${refNum}</div></div>
  <div><div class="meta-label">Tax Year</div><div class="meta-value">${selectedYear}</div></div>
  <div><div class="meta-label">Status</div><div class="meta-value">Indicative</div></div>
</div>
<div class="client-box"><div class="client-title">Client Details</div>
<table>${clientLine('Name:', clientName)}${clientLine('TIC:', clientTIC)}${clientLine('ID No:', clientID)}${clientLine('DOB:', clientDOB ? new Date(clientDOB).toLocaleDateString('en-GB') : '')}${clientLine('Address:', clientAddress)}${clientLine('SI No:', clientSSN)}</table>
</div>
<div class="section-title">Part A — Income</div>
<table>${r.grossEmployment > 0 ? `<tr><td>Employment income (incl. BIK)</td><td>${fmt(r.grossEmployment)}</td></tr>` : ''}
${r.grossSelfEmp > 0 ? `<tr><td>Self-employment income</td><td>${fmt(r.grossSelfEmp)}</td></tr>` : ''}
${r.grossRent > 0 ? `<tr><td>Rental income (gross)</td><td>${fmt(r.grossRent)}</td></tr>` : ''}
<tr class="bold"><td>Total Income for Progressive PIT</td><td>${fmt(r.totalProgressiveIncome)}</td></tr></table>
${r.totalDeductions > 0 ? `<div class="section-title">Part B — Allowable Deductions</div><table>
${r.totalSI > 0 ? `<tr><td class="indent">Social Insurance contributions</td><td>(${fmt(r.totalSI)})</td></tr>` : ''}
${r.totalGHS > 0 ? `<tr><td class="indent">GHS / GeSY contributions</td><td>(${fmt(r.totalGHS)})</td></tr>` : ''}
<tr class="bold"><td>Total Deductions</td><td>(${fmt(r.totalDeductions + r.lossesUsed + r.total2026Allowances)})</td></tr></table>` : ''}
<table><tr class="highlight"><td>CHARGEABLE INCOME</td><td>${fmt(r.chargeableIncome)}</td></tr></table>
${r.bandBreakdown.length > 0 ? `<div class="section-title">Part C — Income Tax (Progressive Bands)</div><table>
${r.bandBreakdown.map(b => `<tr><td class="indent">${b.range} @ ${(b.rate * 100).toFixed(0)}% on ${fmt(b.taxable)}</td><td>${fmt(b.tax)}</td></tr>`).join('')}
<tr class="bold"><td>Personal Income Tax (PIT)</td><td style="color:#9b861f">${fmt(r.pit)}</td></tr></table>` : ''}
<div class="summary-box"><div class="summary-title">Summary of Liability</div>
<div class="summary-row"><span>Personal Income Tax (PIT)</span><span>${fmt(r.pit)}</span></div>
${r.totalSDC > 0 ? `<div class="summary-row"><span>Special Defence Contribution</span><span>${fmt(r.totalSDC)}</span></div>` : ''}
<div class="summary-row"><span>Social Insurance contributions</span><span>${fmt(r.totalSI)}</span></div>
<div class="summary-row"><span>GHS / GeSY contributions</span><span>${fmt(r.totalGHS)}</span></div>
<div class="summary-row final"><span>TOTAL LIABILITY</span><span>${fmt(r.totalLiability)}</span></div>
</div>
<div class="net-box"><div class="net-label">Net Take-Home</div><div class="net-value">${fmt(r.netIncome)}</div><div class="net-meta">Effective tax rate: ${r.effectiveRate.toFixed(2)}% · Monthly equivalent: ${fmt(r.netIncome / 12)}</div></div>
</body></html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    if (w) { w.document.write(html); w.document.close(); }
    setShowExportDialog(false);
  };

  // Print-friendly view (clean light theme suitable for printing or screen review)
  if (printFriendlyMode) {
    const r = activeResults;
    const Y = TAX_YEARS[selectedYear];
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const refNum = `PCC-${selectedYear}-${Date.now().toString().slice(-6)}`;

    const PFRow = ({ label, value, indent = 0, bold = false, italic = false, gold = false, highlight = false }) => (
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: highlight ? '8px 12px' : '4px 0',
        paddingLeft: indent ? `${indent * 16}px` : (highlight ? '12px' : 0),
        borderBottom: highlight ? '2px solid #1a365d' : '1px solid #f0ede4',
        borderTop: highlight ? '2px solid #1a365d' : 'none',
        background: highlight ? '#f8f6f0' : 'transparent',
        fontSize: highlight ? '11pt' : '9.5pt',
        color: gold ? '#9b861f' : (highlight || bold ? '#1a365d' : '#1a1a1a'),
        fontWeight: bold || highlight ? 600 : 400,
        fontStyle: italic ? 'italic' : 'normal',
      }}>
        <span>{label}</span>
        {value && <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold || highlight ? 700 : 500 }}>{value}</span>}
      </div>
    );

    const PFSectionTitle = ({ children }) => (
      <div style={{
        color: '#9b861f',
        fontWeight: 700,
        fontSize: '9pt',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        paddingBottom: '3px',
        borderBottom: '1px solid #9b861f',
        marginTop: '14px',
        marginBottom: '4px',
      }}>{children}</div>
    );

    return (
      <div style={{ fontFamily: 'Helvetica, Arial, sans-serif', background: '#ececec', minHeight: '100vh', padding: '20px', color: '#1a1a1a' }}>
        <style>{`
          @page { size: A4; margin: 15mm; }
          @media print {
            body { background: white !important; }
            .no-print { display: none !important; }
            .pf-page { box-shadow: none !important; margin: 0 !important; padding: 12mm !important; max-width: none !important; }
          }
        `}</style>

        {/* Print controls */}
        <div className="no-print" style={{ maxWidth: '210mm', margin: '0 auto 12px auto', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={() => window.print()} style={{
            padding: '8px 18px', background: '#9b861f', color: 'white', border: 'none', borderRadius: '3px',
            cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
          }}>
            <Printer size={14} /> Print
          </button>
          <button onClick={() => setPrintFriendlyMode(false)} style={{
            padding: '8px 18px', background: 'white', color: '#1a365d', border: '1px solid #1a365d', borderRadius: '3px',
            cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
          }}>
            <EyeOff size={14} /> Back to Calculator
          </button>
        </div>

        {/* The printable page */}
        <div className="pf-page" style={{
          maxWidth: '210mm',
          margin: '0 auto',
          background: 'white',
          padding: '20mm',
          boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
          borderRadius: '2px',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '8px',
            borderBottom: '2px solid #9b861f',
            marginBottom: '12px',
          }}>
            <img src={FIRM_LOGO} style={{ height: '80px', width: 'auto' }} alt="PC Prime & Calculate" />
            <div style={{ textAlign: 'right', fontSize: '8.5pt', color: '#5a6478', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: '#1a365d', fontSize: '10pt' }}>Panayiotis Savvas</div>
              <div style={{ color: '#9b861f', fontStyle: 'italic', fontSize: '8pt' }}>Professional Accountant (SA)</div>
              <div>m: +357 96 332 274</div>
              <div>e: panayiotis@primeandcalculate.com</div>
            </div>
          </div>

          {/* Title */}
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: '#1a365d', letterSpacing: '0.04em' }}>PERSONAL TAX COMPUTATION</div>
            <div style={{ fontSize: '11pt', color: '#9b861f', fontStyle: 'italic' }}>Cyprus — Tax Year {selectedYear}</div>
          </div>

          {/* Meta */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            background: '#f8f6f0',
            borderLeft: '3px solid #9b861f',
            padding: '8px 12px',
            marginBottom: '12px',
            fontSize: '8.5pt',
          }}>
            <div><div style={{ fontSize: '7pt', color: '#5a6478', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Date Prepared</div><div style={{ fontWeight: 700, color: '#1a365d' }}>{today}</div></div>
            <div><div style={{ fontSize: '7pt', color: '#5a6478', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reference</div><div style={{ fontWeight: 700, color: '#1a365d' }}>{refNum}</div></div>
            <div><div style={{ fontSize: '7pt', color: '#5a6478', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tax Year</div><div style={{ fontWeight: 700, color: '#1a365d' }}>{selectedYear}</div></div>
            <div><div style={{ fontSize: '7pt', color: '#5a6478', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div><div style={{ fontWeight: 700, color: '#1a365d' }}>Indicative</div></div>
          </div>

          {/* Client */}
          <div style={{ border: '1px solid #e4e2da', padding: '10px 12px', marginBottom: '12px' }}>
            <div style={{ color: '#9b861f', fontWeight: 700, fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '5px' }}>Client Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: '9pt' }}>
              <div><span style={{ color: '#5a6478', display: 'inline-block', width: '60px' }}>Name:</span><span style={{ color: clientName ? '#1a365d' : '#b8bdc7', fontWeight: clientName ? 600 : 400, fontStyle: clientName ? 'normal' : 'italic' }}>{clientName || 'Not provided'}</span></div>
              <div><span style={{ color: '#5a6478', display: 'inline-block', width: '60px' }}>TIC:</span><span style={{ color: clientTIC ? '#1a365d' : '#b8bdc7', fontWeight: clientTIC ? 600 : 400, fontStyle: clientTIC ? 'normal' : 'italic' }}>{clientTIC || 'Not provided'}</span></div>
              <div><span style={{ color: '#5a6478', display: 'inline-block', width: '60px' }}>ID No:</span><span style={{ color: clientID ? '#1a365d' : '#b8bdc7', fontWeight: clientID ? 600 : 400, fontStyle: clientID ? 'normal' : 'italic' }}>{clientID || 'Not provided'}</span></div>
              <div><span style={{ color: '#5a6478', display: 'inline-block', width: '60px' }}>DOB:</span><span style={{ color: clientDOB ? '#1a365d' : '#b8bdc7', fontWeight: clientDOB ? 600 : 400, fontStyle: clientDOB ? 'normal' : 'italic' }}>{clientDOB ? new Date(clientDOB).toLocaleDateString('en-GB') : 'Not provided'}</span></div>
              <div><span style={{ color: '#5a6478', display: 'inline-block', width: '60px' }}>Address:</span><span style={{ color: clientAddress ? '#1a365d' : '#b8bdc7', fontWeight: clientAddress ? 600 : 400, fontStyle: clientAddress ? 'normal' : 'italic' }}>{clientAddress || 'Not provided'}</span></div>
              <div><span style={{ color: '#5a6478', display: 'inline-block', width: '60px' }}>SI No:</span><span style={{ color: clientSSN ? '#1a365d' : '#b8bdc7', fontWeight: clientSSN ? 600 : 400, fontStyle: clientSSN ? 'normal' : 'italic' }}>{clientSSN || 'Not provided'}</span></div>
            </div>
          </div>

          {/* Part A - Income */}
          <PFSectionTitle>Part A — Income</PFSectionTitle>
          {r.grossEmployment > 0 && <PFRow label="Employment income (incl. BIK)" value={fmt(r.grossEmployment)} />}
          {r.exemptIncome > 0 && <PFRow label={`Less: ${r.reliefName}`} value={`(${fmt(r.exemptIncome)})`} indent={1} italic />}
          {r.grossSelfEmp > 0 && <PFRow label="Self-employment income" value={fmt(r.grossSelfEmp)} />}
          {r.grossRent > 0 && <PFRow label="Rental income (gross)" value={fmt(r.grossRent)} />}
          {r.grossRent > 0 && <PFRow label="Less: 20% wear & tear + interest" value={`(${fmt(r.grossRent - r.rentNet)})`} indent={1} italic />}
          {r.foreignPensionAddedToProgressive > 0 && <PFRow label="Foreign pension (progressive)" value={fmt(r.foreignPensionAddedToProgressive)} />}
          {r.otherInc > 0 && <PFRow label="Other taxable income" value={fmt(r.otherInc)} />}
          <PFRow label="Total Income for Progressive PIT" value={fmt(r.totalProgressiveIncome)} bold />

          {/* Part B - Deductions */}
          {r.totalDeductions > 0 && (
            <>
              <PFSectionTitle>Part B — Allowable Deductions</PFSectionTitle>
              {r.totalSI > 0 && <PFRow label="Social Insurance contributions" value={`(${fmt(r.totalSI)})`} indent={1} />}
              {r.totalGHS > 0 && <PFRow label="GHS / GeSY contributions" value={`(${fmt(r.totalGHS)})`} indent={1} />}
              {r.cappedOptional > 0 && <PFRow label="Pension/Medical/Life (capped)" value={`(${fmt(r.cappedOptional)})`} indent={1} />}
              {r.donationsAllowed > 0 && <PFRow label="Donations to approved charities" value={`(${fmt(r.donationsAllowed)})`} indent={1} />}
              {r.subscriptionsAllowed > 0 && <PFRow label="Professional subscriptions" value={`(${fmt(r.subscriptionsAllowed)})`} indent={1} />}
              {r.lossesUsed > 0 && <PFRow label="Losses brought forward" value={`(${fmt(r.lossesUsed)})`} indent={1} />}
              {r.total2026Allowances > 0 && <PFRow label="2026 family/housing/green allowances" value={`(${fmt(r.total2026Allowances)})`} indent={1} gold />}
              <PFRow label="Total Deductions" value={`(${fmt(r.totalDeductions + r.lossesUsed + r.total2026Allowances)})`} bold />
            </>
          )}

          {/* Chargeable Income */}
          <div style={{ marginTop: '8px' }}>
            <PFRow label="CHARGEABLE INCOME" value={fmt(r.chargeableIncome)} highlight />
          </div>

          {/* Part C - PIT */}
          {r.bandBreakdown.length > 0 && (
            <>
              <PFSectionTitle>Part C — Income Tax (Progressive Bands)</PFSectionTitle>
              {r.bandBreakdown.map((b, i) => (
                <PFRow key={i} label={`${b.range} @ ${(b.rate * 100).toFixed(0)}% on ${fmt(b.taxable)}`} value={fmt(b.tax)} indent={1} />
              ))}
              <PFRow label="Personal Income Tax (PIT)" value={fmt(r.pit)} bold gold />
            </>
          )}

          {/* Part D - SDC */}
          {r.totalSDC > 0 && (
            <>
              <PFSectionTitle>Part D — Special Defence Contribution</PFSectionTitle>
              {r.sdcDividends > 0 && <PFRow label={`Dividends @ ${(Y.sdcRates.dividends * 100).toFixed(0)}%`} value={fmt(r.sdcDividends)} indent={1} />}
              {r.sdcInterest > 0 && <PFRow label={`Interest @ ${(Y.sdcRates.interest * 100).toFixed(0)}%`} value={fmt(r.sdcInterest)} indent={1} />}
              {r.sdcRental > 0 && <PFRow label="Rental @ 2.25%" value={fmt(r.sdcRental)} indent={1} />}
              <PFRow label="Total SDC" value={fmt(r.totalSDC)} bold />
            </>
          )}

          {/* Summary box */}
          <div style={{ background: '#0a1628', color: '#e8e6e0', border: '2px solid #9b861f', padding: '10px 14px', marginTop: '14px' }}>
            <div style={{ textAlign: 'center', color: '#9b861f', fontWeight: 700, fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: '8px' }}>Summary of Liability</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9.5pt' }}><span>Personal Income Tax (PIT)</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt(r.pit)}</span></div>
            {r.totalSDC > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9.5pt' }}><span>Special Defence Contribution</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt(r.totalSDC)}</span></div>}
            {r.cryptoTax > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9.5pt' }}><span>Crypto tax (8% flat)</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt(r.cryptoTax)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9.5pt' }}><span>Social Insurance contributions</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt(r.totalSI)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '9.5pt' }}><span>GHS / GeSY contributions</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt(r.totalGHS)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 2px 0', borderTop: '1.5px solid #9b861f', marginTop: '5px', fontSize: '11.5pt', fontWeight: 700, color: '#9b861f' }}>
              <span>TOTAL LIABILITY</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.totalLiability)}</span>
            </div>
          </div>

          {/* Net Take-Home box */}
          <div style={{ background: '#f8f6f0', border: '2px solid #9b861f', textAlign: 'center', padding: '12px', marginTop: '10px' }}>
            <div style={{ color: '#5a6478', fontWeight: 700, fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.18em' }}>Net Take-Home</div>
            <div style={{ color: '#9b861f', fontWeight: 700, fontSize: '24pt', margin: '3px 0' }}>{fmt(r.netIncome)}</div>
            <div style={{ color: '#5a6478', fontSize: '8.5pt' }}>Effective tax rate: {r.effectiveRate.toFixed(2)}% &middot; Monthly equivalent: {fmt(r.netIncome / 12)}</div>
          </div>

          {/* Confidentiality Notice */}
          <div style={{ background: '#f8f6f0', borderLeft: '3px solid #9b861f', padding: '8px 12px', marginTop: '14px', fontSize: '7pt', color: '#5a6478', fontStyle: 'italic', lineHeight: 1.45 }}>
            <strong style={{ color: '#1a365d', fontStyle: 'normal' }}>CONFIDENTIALITY NOTICE:</strong> This document and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this document and any attachments from your system. Any unauthorized use, disclosure, or distribution is prohibited.
          </div>

          {/* Disclaimer */}
          <div style={{ paddingTop: '6px', borderTop: '1px solid #9b861f', marginTop: '10px', fontSize: '6.8pt', color: '#5a6478', lineHeight: 1.45 }}>
            <strong style={{ color: '#1a365d' }}>Disclaimer:</strong> This computation is indicative only, prepared based on data provided. It does not constitute a formal tax return and should not be filed as such with the Cyprus Tax Department. Verify all figures against original supporting documents before formal filing through TAXISnet / TAX FOR ALL (TFA). Individual circumstances may produce different results. This document does not constitute tax advice; consult your professional accountant for advice specific to your situation. &middot; Prepared by PC Prime &amp; Calculate Consultants Ltd &middot; Reference: {refNum} &middot; Generated: {today}
          </div>
        </div>
      </div>
    );
  }

  return (
    <EmbeddedContext.Provider value={embedded}>
    <div style={{
      fontFamily: "'Montserrat', -apple-system, sans-serif",
      // Public /tax — full-bleed navy page. Portal — flow inside the tab with a soft cream background.
      background: embedded ? '#f5f1e6' : COLORS.frame,
      minHeight: embedded ? 'auto' : '100vh',
      padding: embedded ? '1rem' : '2rem 1.25rem',
      color: COLORS.text,
      borderRadius: embedded ? '4px' : 0,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600;700&display=swap');
        .serif { font-family: 'Cormorant Garamond', Georgia, serif; }
        input[type="checkbox"] { accent-color: #9b861f; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: #9b861f !important; }
        select option { background: #ffffff; color: #0f1f3d; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.3s ease-out; }
      `}</style>

      <div style={{
        maxWidth: '1500px', margin: '0 auto',
        background: COLORS.card,
        borderRadius: embedded ? '4px' : '10px',
        padding: embedded ? '1.25rem 1.5rem' : '2rem 1.75rem',
        // Lighter "paper sitting on the desk" feel inside the portal.
        boxShadow: embedded ? '0 1px 3px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0,0,0,0.18)',
        border: embedded ? `1px solid ${COLORS.border}` : 'none',
      }}>
        {/* HEADER — public /tax only. In the portal the tab header already labels the context. */}
        {!embedded && (
          <div style={{ textAlign: 'center', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ display: 'inline-block', padding: '0.2rem 0.9rem', border: `1px solid ${COLORS.accent}`, borderRadius: '2px', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.62rem', letterSpacing: '0.2em', color: COLORS.accent, textTransform: 'uppercase', fontWeight: 500 }}>
                PC Prime & Calculate Consultants Ltd
              </span>
            </div>
            <h1 className="serif" style={{ fontSize: '2rem', fontWeight: 600, margin: '0.3rem 0', color: COLORS.text }}>
              Cyprus Personal Tax Calculator
            </h1>
            <p style={{ color: COLORS.textDim, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
              Multi-Year · 2025 · 2026 · Comparison · PDF Export
            </p>
          </div>
        )}

        {/* CONTROLS */}
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '4px', padding: '1rem 1.25rem', marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', color: COLORS.textMuted, letterSpacing: '0.05em' }}>Tax Year:</span>
            <div style={{ display: 'flex', gap: '0' }}>
              {[2024, 2025, 2026].map(y => (
                <button key={y} onClick={() => { if (taxYearLock != null) return; setSelectedYear(y); setComparisonMode(false); }}
                  disabled={taxYearLock != null && taxYearLock !== y}
                  style={{ padding: '0.5rem 1.1rem',
                    background: !comparisonMode && selectedYear === y ? COLORS.accent : 'transparent',
                    color: !comparisonMode && selectedYear === y ? COLORS.bg : COLORS.textMuted,
                    border: `1px solid ${!comparisonMode && selectedYear === y ? COLORS.accent : COLORS.border}`,
                    cursor: taxYearLock != null ? 'not-allowed' : 'pointer',
                    opacity: taxYearLock != null && taxYearLock !== y ? 0.35 : 1,
                    fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
                    borderRadius: y === 2024 ? '3px 0 0 3px' : (y === 2026 ? '0 3px 3px 0' : 0),
                    borderLeft: y !== 2024 ? 'none' : undefined,
                  }}>
                  {y}
                </button>
              ))}
              {taxYearLock != null && <span style={{ fontSize: '0.7rem', color: COLORS.textDim, marginLeft: '0.5rem', fontStyle: 'italic' }}>(locked for this return)</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => setComparisonMode(!comparisonMode)}
              style={{ padding: '0.5rem 1rem', background: comparisonMode ? COLORS.accent : 'transparent',
                color: comparisonMode ? COLORS.bg : COLORS.accent, border: `1px solid ${COLORS.accent}`,
                borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <GitCompare size={14} />
              {comparisonMode ? 'Comparison ON' : 'Compare 2025 vs 2026'}
            </button>

            {!comparisonMode && (
              <button onClick={() => setShowExportDialog(true)}
                disabled={activeResults.totalGrossIncome === 0}
                style={{ padding: '0.5rem 1rem', background: activeResults.totalGrossIncome > 0 ? COLORS.accent : COLORS.borderLight,
                  color: activeResults.totalGrossIncome > 0 ? COLORS.bg : COLORS.textDim,
                  border: `1px solid ${activeResults.totalGrossIncome > 0 ? COLORS.accent : COLORS.borderLight}`,
                  borderRadius: '3px', cursor: activeResults.totalGrossIncome > 0 ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <FileDown size={14} />
                Export PDF
              </button>
            )}

            {onSave && (
              <button onClick={handleSave}
                disabled={saveStatus === 'saving'}
                style={{ padding: '0.5rem 1rem',
                  background: saveStatus === 'error' ? COLORS.danger : COLORS.success,
                  color: COLORS.bg,
                  border: `1px solid ${saveStatus === 'error' ? COLORS.danger : COLORS.success}`,
                  borderRadius: '3px', cursor: saveStatus === 'saving' ? 'wait' : 'pointer',
                  fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Save failed — retry' : 'Save Tax Return'}
              </button>
            )}
          </div>

          {!comparisonMode && (
            <div style={{ fontSize: '0.72rem', color: COLORS.textDim, fontStyle: 'italic', flexBasis: '100%' }}>
              <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px' }} />
              {Y.notes}
            </div>
          )}
        </div>

        {/* EXPORT DIALOG */}
        {showExportDialog && (
          <div onClick={() => setShowExportDialog(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: COLORS.card, border: `2px solid ${COLORS.accent}`, borderRadius: '6px',
                padding: '1.5rem', maxWidth: '480px', width: '100%' }}>
              <h3 className="serif" style={{ color: COLORS.accent, fontSize: '1.4rem', marginBottom: '0.5rem' }}>
                Export Tax Computation
              </h3>
              <p style={{ color: COLORS.textDim, fontSize: '0.82rem', marginBottom: '1.25rem' }}>
                Choose your preferred export method for Tax Year {selectedYear}.
              </p>

              {/* PDF DOWNLOAD - Primary (professional summary) */}
              <button onClick={handleDownloadPDF}
                style={{ width: '100%', padding: '0.85rem', background: COLORS.accent, color: COLORS.bg,
                  border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <FileDown size={16} />
                Download PDF (Summary)
              </button>
              <p style={{ fontSize: '0.68rem', color: COLORS.textDim, marginBottom: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                Professional branded computation summary — for client deliverables and the firm's file
              </p>

              {/* TD1 FILING-FORMAT PDF (portal-only) */}
              {embedded && (
                <>
                  <button onClick={handleDownloadTd1Pdf}
                    style={{ width: '100%', padding: '0.85rem', background: COLORS.bg, color: COLORS.accent,
                      border: `1.5px solid ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <FileDown size={16} />
                    Download TD1 PDF ({formType === 'self_employed' ? 'Self Employed' : 'Individuals'})
                  </button>
                  <p style={{ fontSize: '0.68rem', color: COLORS.textDim, marginBottom: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                    TD1-shaped filing draft — all parts laid out with codes / columns matching the official form
                  </p>

                  {/* TAXISNET XML (portal-only) — for direct import into TaxisNet */}
                  <button onClick={handleDownloadTaxisnetXml} disabled={xmlBusy}
                    style={{ width: '100%', padding: '0.85rem', background: COLORS.bg, color: COLORS.accent,
                      border: `1.5px solid ${COLORS.accent}`, borderRadius: '3px', cursor: xmlBusy ? 'wait' : 'pointer', fontFamily: 'inherit',
                      fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem', opacity: xmlBusy ? 0.6 : 1 }}>
                    <FileCode size={16} />
                    {xmlBusy ? 'Saving…' : `Download TaxisNet XML (${formType === 'self_employed' ? 'epr1a' : 'epr1m'})`}
                  </button>
                  <p style={{ fontSize: '0.68rem', color: COLORS.textDim, marginBottom: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                    Official Ministry of Finance XML for direct upload to TaxisNet{onSaveXmlToClient ? ' — also filed in the client’s Documents folder' : ''}
                  </p>
                </>
              )}

              {/* CSV EXPORT */}
              <button onClick={handleDownloadCSV}
                style={{ width: '100%', padding: '0.7rem', background: 'transparent', color: COLORS.accent,
                  border: `1px solid ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <FileSpreadsheet size={15} />
                Download CSV (Excel)
              </button>
              <p style={{ fontSize: '0.68rem', color: COLORS.textDim, marginBottom: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                Open in Excel for record-keeping or further analysis
              </p>

              {/* EMAIL */}
              <button onClick={handleEmailClient}
                style={{ width: '100%', padding: '0.7rem', background: 'transparent', color: COLORS.accent,
                  border: `1px solid ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <Mail size={15} />
                Email to Client
              </button>
              <p style={{ fontSize: '0.68rem', color: COLORS.textDim, marginBottom: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                Opens your email with a pre-filled professional message
              </p>

              {/* PRINT FRIENDLY MODE */}
              <button onClick={() => { setPrintFriendlyMode(true); setShowExportDialog(false); }}
                style={{ width: '100%', padding: '0.7rem', background: 'transparent', color: COLORS.accent,
                  border: `1px solid ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <Eye size={15} />
                Print-Friendly View
              </button>
              <p style={{ fontSize: '0.68rem', color: COLORS.textDim, marginBottom: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                Switches calculator to clean light-themed printable layout
              </p>

              {/* PRINT PREVIEW (FALLBACK) */}
              <button onClick={handlePrintPreview}
                style={{ width: '100%', padding: '0.55rem', background: 'transparent', color: COLORS.textDim,
                  border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.75rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.85rem' }}>
                <Printer size={13} />
                Browser Print Preview (fallback)
              </button>

              <button onClick={() => setShowExportDialog(false)}
                style={{ width: '100%', padding: '0.55rem', background: 'transparent', color: COLORS.textDim,
                  border: `1px solid ${COLORS.border}`, borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.78rem' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{
          display: 'grid',
          // In the portal we want a single full-width column (the computation panel
          // is shown stacked below the inputs). Public /tax keeps the 2-col layout
          // and the 3-col comparison layout.
          gridTemplateColumns: embedded
            ? '1fr'
            : (comparisonMode ? 'minmax(0, 0.85fr) minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1.1fr) minmax(0, 1fr)'),
          gap: '1rem',
        }}>

          <div>
            {/* CLIENT DETAILS SECTION */}
            <Section id="client" title={embedded ? 'Client Details (from client record)' : 'Client Details (for PDF)'} icon={User} isOpen={openSections.client} onToggle={toggleSection} summary={clientName ? `· ${clientName}` : '(optional)'}>
              <InputRow label="Client Name" value={clientName} onChange={setClientName} type="text" placeholder="e.g. John Demetriou" readOnly={embedded} />
              <InputRow label="Tax Identification Code (TIC)" value={clientTIC} onChange={setClientTIC} type="text" placeholder="e.g. 12345678X" readOnly={embedded} />
              <InputRow label="ID / Passport Number" value={clientID} onChange={setClientID} type="text" placeholder="e.g. 987654321" readOnly={embedded} />
              <InputRow label="Date of Birth" value={clientDOB} onChange={setClientDOB} type="date" placeholder="" readOnly={embedded} />
              <InputRow label="Social Insurance Number" value={clientSSN} onChange={setClientSSN} type="text" placeholder="e.g. 12345678" readOnly={embedded} />
              <InputRow label="Address" value={clientAddress} onChange={setClientAddress} type="text" placeholder="e.g. 1 Main St, Nicosia" readOnly={embedded} />
              <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.65rem', background: COLORS.bg, borderLeft: `2px solid ${COLORS.accent}`, borderRadius: '2px', fontSize: '0.7rem', color: COLORS.textDim, lineHeight: 1.5 }}>
                <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px' }} />
                {embedded ? 'These details are pulled from the client record. Edit them in the Client Info tab.' : 'These details appear on the exported PDF. Leave blank for a generic computation.'}
              </div>
            </Section>

            {/* SECTION 0: PERSONAL PROFILE */}
            <Section id="profile" title="0. Personal Profile" icon={User} isOpen={openSections.profile} onToggle={toggleSection} summary={taxResident ? `· Resident (${residencyRule}-day)` : '· Non-resident'}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={taxResident} onChange={(e) => setTaxResident(e.target.checked)} />
                <strong style={{ color: COLORS.text }}>Cyprus Tax Resident</strong>
              </label>

              {taxResident && (
                <div style={{ marginBottom: '0.85rem', paddingLeft: '1rem', borderLeft: `2px solid ${COLORS.borderLight}` }}>
                  <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, display: 'block', marginBottom: '0.25rem' }}>Residency Rule</label>
                  <select value={residencyRule} onChange={(e) => setResidencyRule(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontSize: '0.83rem' }}>
                    <option value="183">183-day rule (standard)</option>
                    <option value="60">60-day rule (high earners)</option>
                  </select>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={firstEmployment} onChange={(e) => setFirstEmployment(e.target.checked)} />
                <span>First employment in Cyprus <span style={{ color: COLORS.textDim, fontSize: '0.72rem' }}>(20% relief, max €8,550)</span></span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={hasDisability} onChange={(e) => setHasDisability(e.target.checked)} />
                <span>Disability — self <span style={{ color: COLORS.textDim, fontSize: '0.72rem' }}>(may qualify for additional reliefs)</span></span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={hasDisabledDependant} onChange={(e) => setHasDisabledDependant(e.target.checked)} />
                <span>Disabled dependant <span style={{ color: COLORS.textDim, fontSize: '0.72rem' }}>(check eligibility for relief)</span></span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: clientDOB ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={activeResults.effectiveOver65} onChange={(e) => setIsOver65(e.target.checked)} disabled={!!clientDOB} />
                <span>Age 65 or over <span style={{ color: COLORS.textDim, fontSize: '0.72rem' }}>{clientDOB ? `(auto-derived: age ${activeResults.ageAtYearEnd} at end of ${selectedYear})` : '(exempt from Social Insurance; GHS still applies)'}</span></span>
              </label>

              <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.65rem', background: COLORS.bg, borderLeft: `2px solid ${COLORS.accent}`, borderRadius: '2px', fontSize: '0.7rem', color: COLORS.textDim, lineHeight: 1.5 }}>
                <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px' }} />
                Tax residency affects SDC liability. Disability allowances should be claimed via the formal TD1 supporting documentation.
              </div>
            </Section>

            <Section id="income" title="1. Income" icon={Briefcase} isOpen={openSections.income} onToggle={toggleSection}>
              {/* Self-employed-form specific sections (Part 3.C books + 4.1 activities + 4.2 disposal + 4.3 partnerships) */}
              {embedded && formType === 'self_employed' && (
                <>
                  <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                    Books & Records <span style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: COLORS.textDim }}>— TD1 Part 3.C</span>
                  </div>
                  <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', padding: '0.65rem', marginBottom: '0.85rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selfEmpTurnoverUnder70k} onChange={(e) => setSelfEmpTurnoverUnder70k(e.target.checked)} />
                      <span>Turnover up to <strong>€70,000</strong> (simpler 6C/6D path)</span>
                    </label>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Audited / Inspected Accounts</label>
                      <select value={selfEmpAuditedAccounts} onChange={e => setSelfEmpAuditedAccounts(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem 0.75rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.82rem' }}>
                        <option value="none">No</option>
                        <option value="inspected">Yes — inspected</option>
                        <option value="audited">Yes — audited</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                    Trade / Industry / Profession <span style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: COLORS.textDim }}>— TD1 Part 4.1 (one row per activity)</span>
                  </div>
                  {selfEmployedActivities.map((a) => (
                    <div key={a.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', padding: '0.65rem', marginBottom: '0.65rem' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: COLORS.accent }}>Main Trade Activity</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                        <div style={{ marginBottom: '0.7rem' }}>
                          <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Main Activity</label>
                          <select value={a.mainCategory} onChange={e => updateSelfEmpActivity(a.id, 'mainCategory', e.target.value)}
                            style={{ width: '100%', padding: '0.55rem 0.75rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.82rem' }}>
                            {SELF_EMP_ACTIVITY_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                          </select>
                        </div>
                        <div style={{ marginBottom: '0.7rem' }}>
                          <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Occupational Category (GHS)</label>
                          <select value={a.occupationalCategory} onChange={e => updateSelfEmpActivity(a.id, 'occupationalCategory', e.target.value)}
                            style={{ width: '100%', padding: '0.55rem 0.75rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.82rem' }}>
                            {SELF_EMP_OCCUPATIONAL_OPTIONS.map(c => <option key={c} value={c}>{c === 'NA' ? 'N/A (short-term rental — 2.65% GHS)' : `Cat. ${c} (4% GHS)`}</option>)}
                          </select>
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={a.isOutsideRepublic} onChange={(e) => updateSelfEmpActivity(a.id, 'isOutsideRepublic', e.target.checked)} />
                        <span>Income arises <strong>outside</strong> the Republic of Cyprus</span>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                        <InputRow label="Taxable Profit Current Year (€)"
                          value={a.taxableProfit} onChange={v => updateSelfEmpActivity(a.id, 'taxableProfit', v)} />
                        <InputRow label="(Loss) Current Year (€)"
                          value={a.lossCurrentYear} onChange={v => updateSelfEmpActivity(a.id, 'lossCurrentYear', v)} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                        <InputRow label="Losses BF from 1997 (€)"
                          value={a.lossesBfFrom1997} onChange={v => updateSelfEmpActivity(a.id, 'lossesBfFrom1997', v)} />
                        <InputRow label="Losses > 5y Not Carried (€)"
                          value={a.lossesMoreThan5yNotCarried} onChange={v => updateSelfEmpActivity(a.id, 'lossesMoreThan5yNotCarried', v)} />
                      </div>
                      {a.isOutsideRepublic && (
                        <InputRow label="Tax Paid Outside Republic (€)" hint="foreign tax credit"
                          value={a.taxPaidOutside} onChange={v => updateSelfEmpActivity(a.id, 'taxPaidOutside', v)} />
                      )}
                    </div>
                  ))}
                  {/* Self-employed clients file one trade activity per return — no "Add" button. */}

                  <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                    Property / Shares Disposal <span style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: COLORS.textDim }}>— TD1 Part 4.2 (gain/loss on disposal)</span>
                  </div>
                  <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', padding: '0.65rem', marginBottom: '0.85rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Gain from Immovable Property (€)"
                        value={disposalGainImmovable} onChange={setDisposalGainImmovable} />
                      <InputRow label="Gain from Shares in Private Co. (€)"
                        value={disposalGainShares} onChange={setDisposalGainShares} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="(Loss) from Immovable Property (€)"
                        value={disposalLossImmovable} onChange={setDisposalLossImmovable} />
                      <InputRow label="(Loss) from Shares in Private Co. (€)"
                        value={disposalLossShares} onChange={setDisposalLossShares} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="TIC / Reg. No. of Company" type="text" placeholder=""
                        value={disposalTicOfCompany} onChange={setDisposalTicOfCompany} />
                      <InputRow label="Country of TIC" type="text" placeholder=""
                        value={disposalCountry} onChange={setDisposalCountry} />
                    </div>
                  </div>

                  <div style={TD1.caption}>Part 4.3 — Income from Partnership <span style={TD1.captionItalic}>(one row per partnership)</span></div>
                  <div style={TD1.legend}>
                    <span style={TD1.legendItem}><span style={TD1.legendBadge}>1</span>In Republic</span>
                    <span style={TD1.legendItem}><span style={TD1.legendBadge}>2</span>Outside Republic</span>
                    <span style={{ ...TD1.legendItem, color: '#94a3b8', fontStyle: 'italic' }}>Occupational category 1–16 (4% GHS) or N/A (2.65% GHS short-term rental)</span>
                  </div>
                  <div style={TD1.wrap}>
                    <table style={TD1.table}>
                      <thead>
                        <tr style={TD1.thRow}>
                          <th style={{ ...TD1.th, minWidth: 88 }}>(1) TIC</th>
                          <th style={{ ...TD1.th, minWidth: 160 }}>(2) Partnership Name</th>
                          <th style={{ ...TD1.th, minWidth: 56 }}>(3) Code</th>
                          <th style={{ ...TD1.th, minWidth: 56 }}>(4) Cat.</th>
                          <th style={{ ...TD1.thNum, minWidth: 70 }}>(5) %</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(6) Salary</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(7) Int. Cap.</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(8) Trading</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(9) Loss</th>
                          <th style={{ ...TD1.thNum, minWidth: 90 }}>(10) Tax W/h</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(11) Tax Out</th>
                          <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {partnerships.map((p) => (
                          <tr key={p.id}>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={p.tic} onChange={e => updatePartnership(p.id, 'tic', e.target.value)} placeholder="TIC" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={p.name} onChange={e => updatePartnership(p.id, 'name', e.target.value)} placeholder="Partnership" /></td>
                            <td style={TD1.td}>
                              <select style={TD1.select} value={p.code} onChange={e => updatePartnership(p.id, 'code', e.target.value)}>
                                <option value="1">1</option>
                                <option value="2">2</option>
                              </select>
                            </td>
                            <td style={TD1.td}>
                              <select style={TD1.select} value={p.occupationalCategory} onChange={e => updatePartnership(p.id, 'occupationalCategory', e.target.value)}>
                                {SELF_EMP_OCCUPATIONAL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.percentage} onChange={e => updatePartnership(p.id, 'percentage', e.target.value)} placeholder="0" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.salary} onChange={e => updatePartnership(p.id, 'salary', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.interestOnCapital} onChange={e => updatePartnership(p.id, 'interestOnCapital', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.tradingIncome} onChange={e => updatePartnership(p.id, 'tradingIncome', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.tradingLoss} onChange={e => updatePartnership(p.id, 'tradingLoss', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.taxWithheld} onChange={e => updatePartnership(p.id, 'taxWithheld', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.taxPaidOutside} onChange={e => updatePartnership(p.id, 'taxPaidOutside', e.target.value)} placeholder="0.00" /></td>
                            <td style={{ ...TD1.td, textAlign: 'center' }}>
                              <button type="button" onClick={() => removePartnership(p.id)} style={TD1.removeBtn} title="Remove">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={TD1.tfootRow}>
                          <td colSpan={5} style={TD1.tfootLabel}>TOTAL</td>
                          <td style={TD1.tfootCell}>{fmtSum(partnerships.reduce((s, x) => s + Number(x.salary || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(partnerships.reduce((s, x) => s + Number(x.interestOnCapital || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(partnerships.reduce((s, x) => s + Number(x.tradingIncome || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(partnerships.reduce((s, x) => s + Number(x.tradingLoss || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(partnerships.reduce((s, x) => s + Number(x.taxWithheld || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(partnerships.reduce((s, x) => s + Number(x.taxPaidOutside || 0), 0))}</td>
                          <td style={TD1.tfootLabel}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button type="button" onClick={addPartnership} style={TD1.addBtn}>+ Add partnership</button>
                </>
              )}

              {/* Employment block — TD1 Part 4.A. Hidden for the self-employed form variant. */}
              {!(embedded && formType === 'self_employed') && (
                <>
              <div style={TD1.caption}>Part 4.A — Salaried Services <span style={TD1.captionItalic}>(one row per employer)</span></div>
              {embedded && (
                <div style={TD1.legend}>
                  {EMPLOYMENT_CODES.map(c => <span key={c.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{c.code}</span>{shortCodeLabel(c.label)}</span>)}
                </div>
              )}
              {embedded ? (
                <div style={TD1.wrap}>
                  <table style={TD1.table}>
                    <thead>
                      <tr style={TD1.thRow}>
                        <th style={{ ...TD1.th, minWidth: 88 }}>(1) T.I.C.</th>
                        <th style={{ ...TD1.th, minWidth: 140 }}>(2) Name / Business Name</th>
                        <th style={{ ...TD1.th, minWidth: 60 }}>(3) Code</th>
                        <th style={{ ...TD1.thNum, minWidth: 56 }}>(5) Months</th>
                        <th style={{ ...TD1.thNum, minWidth: 92 }}>(6) Gross in Rep.</th>
                        <th style={{ ...TD1.thNum, minWidth: 92 }}>(7) Gross outside</th>
                        <th style={{ ...TD1.thNum, minWidth: 80 }}>BIK</th>
                        <th style={{ ...TD1.thNum, minWidth: 80 }}>(8) Tax W/h</th>
                        <th style={{ ...TD1.thNum, minWidth: 80 }}>(9) GHS W/h</th>
                        <th style={{ ...TD1.th, minWidth: 110 }}>(10) Commenced</th>
                        <th style={{ ...TD1.th, minWidth: 110 }}>(11) Terminated</th>
                        <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {employments.map((emp) => (
                        <tr key={emp.id}>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={emp.employerTic} onChange={e => updateEmployment(emp.id, 'employerTic', e.target.value)} placeholder="12345678X" /></td>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={emp.employerName} onChange={e => updateEmployment(emp.id, 'employerName', e.target.value)} placeholder="Employer" /></td>
                          <td style={TD1.td}>
                            <select style={TD1.select} value={emp.code} onChange={e => updateEmployment(emp.id, 'code', e.target.value)} title={(EMPLOYMENT_CODES.find(c => c.code === emp.code) || {}).label}>
                              {EMPLOYMENT_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                            </select>
                          </td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={emp.periodMonths} onChange={e => updateEmployment(emp.id, 'periodMonths', e.target.value)} placeholder="12" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={emp.grossInRepublic} onChange={e => updateEmployment(emp.id, 'grossInRepublic', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={emp.grossOutsideRepublic} onChange={e => updateEmployment(emp.id, 'grossOutsideRepublic', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={emp.bik} onChange={e => updateEmployment(emp.id, 'bik', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={emp.taxWithheld} onChange={e => updateEmployment(emp.id, 'taxWithheld', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={emp.ghsWithheld} onChange={e => updateEmployment(emp.id, 'ghsWithheld', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.input} type="date" value={emp.commencementDate} onChange={e => updateEmployment(emp.id, 'commencementDate', e.target.value)} /></td>
                          <td style={TD1.td}><input style={TD1.input} type="date" value={emp.terminationDate} onChange={e => updateEmployment(emp.id, 'terminationDate', e.target.value)} /></td>
                          <td style={{ ...TD1.td, textAlign: 'center' }}>
                            {employments.length > 1 && (
                              <button type="button" onClick={() => removeEmployment(emp.id)} style={TD1.removeBtn} title="Remove employer">✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={TD1.tfootRow}>
                        <td colSpan={4} style={TD1.tfootLabel}>TOTAL</td>
                        <td style={TD1.tfootCell}>{fmtSum(employments.reduce((s, x) => s + Number(x.grossInRepublic || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(employments.reduce((s, x) => s + Number(x.grossOutsideRepublic || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(employments.reduce((s, x) => s + Number(x.bik || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(employments.reduce((s, x) => s + Number(x.taxWithheld || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(employments.reduce((s, x) => s + Number(x.ghsWithheld || 0), 0))}</td>
                        <td colSpan={3} style={TD1.tfootLabel}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                employments.map((emp, idx) => (
                  <div key={emp.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', padding: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: COLORS.accent }}>
                        Employer #{idx + 1}{emp.employerName ? ` — ${emp.employerName}` : ''}
                      </span>
                      {employments.length > 1 && (
                        <button type="button" onClick={() => removeEmployment(emp.id)}
                          style={{ padding: '0.2rem 0.55rem', background: 'transparent', color: COLORS.danger, border: `1px solid ${COLORS.danger}`, borderRadius: '3px', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit' }}
                          title="Remove this employer">✕ Remove</button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Employer Name" type="text" placeholder="e.g. ABC Ltd"
                        value={emp.employerName} onChange={v => updateEmployment(emp.id, 'employerName', v)} />
                      <InputRow label="Employer TIC" type="text" placeholder="e.g. 12345678X"
                        value={emp.employerTic} onChange={v => updateEmployment(emp.id, 'employerTic', v)} />
                    </div>
                    <div style={{ marginBottom: '0.7rem' }}>
                      <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Code (TD1 column 3)</label>
                      <select value={emp.code} onChange={e => updateEmployment(emp.id, 'code', e.target.value)}
                        style={{ width: '100%', padding: '0.55rem 0.75rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.82rem' }}>
                        {EMPLOYMENT_CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Gross in Republic (€)" hint="column 6"
                        value={emp.grossInRepublic} onChange={v => updateEmployment(emp.id, 'grossInRepublic', v)} />
                      <InputRow label="Gross outside Republic (€)" hint="column 7"
                        value={emp.grossOutsideRepublic} onChange={v => updateEmployment(emp.id, 'grossOutsideRepublic', v)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Benefits-in-Kind (€)" hint="company car, COLA"
                        value={emp.bik} onChange={v => updateEmployment(emp.id, 'bik', v)} />
                      <InputRow label="Period (months)" type="number" placeholder="12"
                        value={emp.periodMonths} onChange={v => updateEmployment(emp.id, 'periodMonths', v)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Tax Withheld (€)" hint="PAYE — column 8"
                        value={emp.taxWithheld} onChange={v => updateEmployment(emp.id, 'taxWithheld', v)} />
                      <InputRow label="GHS Withheld (€)" hint="column 9"
                        value={emp.ghsWithheld} onChange={v => updateEmployment(emp.id, 'ghsWithheld', v)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Commencement Date" type="date" placeholder=""
                        value={emp.commencementDate} onChange={v => updateEmployment(emp.id, 'commencementDate', v)} />
                      <InputRow label="Termination Date" type="date" placeholder=""
                        value={emp.terminationDate} onChange={v => updateEmployment(emp.id, 'terminationDate', v)} />
                    </div>
                  </div>
                ))
              )}
              <button type="button" onClick={addEmployment} style={embedded ? TD1.addBtn : { width: '100%', padding: '0.55rem', background: 'transparent', color: COLORS.accent, border: `1px dashed ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.85rem' }}>
                + Add another employer
              </button>

              {!embedded && (
                <>
                  <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '0.85rem', marginBottom: '0.6rem' }}>Self-Employment</div>
                  <InputRow label="Net Business Income (€)" value={selfEmpIncome} onChange={setSelfEmpIncome} hint="after expenses" />
                </>
              )}
                </>
              )}

              <div style={TD1.caption}>Part 4.C — Rents / Income from Immovable Property <span style={TD1.captionItalic}>(one row per property)</span></div>
              {embedded && (
                <div style={TD1.legend}>
                  {PROPERTY_TYPES.map(t => <span key={t.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{t.code}</span>{shortCodeLabel(t.label)}</span>)}
                </div>
              )}
              {embedded ? (
                <div style={TD1.wrap}>
                  <table style={TD1.table}>
                    <thead>
                      <tr style={TD1.thRow}>
                        <th style={{ ...TD1.th, minWidth: 110 }}>(1) Reg. No.</th>
                        <th style={{ ...TD1.th, minWidth: 60 }}>Type</th>
                        <th style={{ ...TD1.th, minWidth: 120 }}>(3) Acquired</th>
                        <th style={{ ...TD1.thNum, minWidth: 56 }}>(8) Share %</th>
                        <th style={{ ...TD1.th, minWidth: 88 }}>(6) Lessee TIC</th>
                        <th style={{ ...TD1.th, minWidth: 140 }}>(7) Lessee Name</th>
                        <th style={{ ...TD1.thNum, minWidth: 90 }}>(10) In Rep.</th>
                        <th style={{ ...TD1.thNum, minWidth: 90 }}>(11) Outside</th>
                        <th style={{ ...TD1.thNum, minWidth: 80 }}>(12) Cap. All.</th>
                        <th style={{ ...TD1.thNum, minWidth: 90 }}>(13) Interest</th>
                        <th style={{ ...TD1.thNum, minWidth: 80 }}>(15) SDC W/h</th>
                        <th style={{ ...TD1.thNum, minWidth: 80 }}>(16) GHS W/h</th>
                        <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rentalProperties.map((r) => (
                        <tr key={r.id}>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={r.registrationNo} onChange={e => updateRentalProperty(r.id, 'registrationNo', e.target.value)} placeholder="Reg." /></td>
                          <td style={TD1.td}>
                            <select style={TD1.select} value={r.propertyTypeCode} onChange={e => updateRentalProperty(r.id, 'propertyTypeCode', e.target.value)} title={(PROPERTY_TYPES.find(t => t.code === r.propertyTypeCode) || {}).label}>
                              {PROPERTY_TYPES.map(t => <option key={t.code} value={t.code}>{t.code}</option>)}
                            </select>
                          </td>
                          <td style={TD1.td}><input style={TD1.input} type="date" value={r.acquisitionDate} onChange={e => updateRentalProperty(r.id, 'acquisitionDate', e.target.value)} /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.ownershipShare} onChange={e => updateRentalProperty(r.id, 'ownershipShare', e.target.value)} placeholder="100" /></td>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={r.lesseeTic} onChange={e => updateRentalProperty(r.id, 'lesseeTic', e.target.value)} placeholder="TIC" /></td>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={r.lesseeName} onChange={e => updateRentalProperty(r.id, 'lesseeName', e.target.value)} placeholder="Tenant" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.annualGrossInRepublic} onChange={e => updateRentalProperty(r.id, 'annualGrossInRepublic', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.annualGrossOutsideRepublic} onChange={e => updateRentalProperty(r.id, 'annualGrossOutsideRepublic', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.capitalAllowances} onChange={e => updateRentalProperty(r.id, 'capitalAllowances', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.interestPayable} onChange={e => updateRentalProperty(r.id, 'interestPayable', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.sdcWithheld} onChange={e => updateRentalProperty(r.id, 'sdcWithheld', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.ghsWithheld} onChange={e => updateRentalProperty(r.id, 'ghsWithheld', e.target.value)} placeholder="0.00" /></td>
                          <td style={{ ...TD1.td, textAlign: 'center' }}>
                            <button type="button" onClick={() => removeRentalProperty(r.id)} style={TD1.removeBtn} title="Remove">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={TD1.tfootRow}>
                        <td colSpan={6} style={TD1.tfootLabel}>TOTAL</td>
                        <td style={TD1.tfootCell}>{fmtSum(rentalProperties.reduce((s, x) => s + Number(x.annualGrossInRepublic || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(rentalProperties.reduce((s, x) => s + Number(x.annualGrossOutsideRepublic || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(rentalProperties.reduce((s, x) => s + Number(x.capitalAllowances || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(rentalProperties.reduce((s, x) => s + Number(x.interestPayable || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(rentalProperties.reduce((s, x) => s + Number(x.sdcWithheld || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(rentalProperties.reduce((s, x) => s + Number(x.ghsWithheld || 0), 0))}</td>
                        <td style={TD1.tfootLabel}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                rentalProperties.map((r, idx) => (
                  <div key={r.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', padding: '0.65rem', marginBottom: '0.65rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: COLORS.accent }}>
                        Property #{idx + 1}{r.registrationNo ? ` — ${r.registrationNo}` : ''}
                      </span>
                      <button type="button" onClick={() => removeRentalProperty(r.id)}
                        style={{ padding: '0.2rem 0.55rem', background: 'transparent', color: COLORS.danger, border: `1px solid ${COLORS.danger}`, borderRadius: '3px', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit' }}
                        title="Remove this property">✕ Remove</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Registration No." type="text" placeholder="Property registration"
                        value={r.registrationNo} onChange={v => updateRentalProperty(r.id, 'registrationNo', v)} />
                      <InputRow label="Acquisition Date" type="date" placeholder=""
                        value={r.acquisitionDate} onChange={v => updateRentalProperty(r.id, 'acquisitionDate', v)} />
                    </div>
                    <div style={{ marginBottom: '0.7rem' }}>
                      <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Property type (TD1 column 1)</label>
                      <select value={r.propertyTypeCode} onChange={e => updateRentalProperty(r.id, 'propertyTypeCode', e.target.value)}
                        style={{ width: '100%', padding: '0.55rem 0.75rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.82rem' }}>
                        {PROPERTY_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Ownership Share (%)" type="number" placeholder="100"
                        value={r.ownershipShare} onChange={v => updateRentalProperty(r.id, 'ownershipShare', v)} />
                      <InputRow label="Lessee Name" type="text" placeholder="Tenant name"
                        value={r.lesseeName} onChange={v => updateRentalProperty(r.id, 'lesseeName', v)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Lessee TIC" type="text" placeholder="if legal person"
                        value={r.lesseeTic} onChange={v => updateRentalProperty(r.id, 'lesseeTic', v)} />
                      <InputRow label="Capital Allowances (€)" hint="col 12 — depreciation"
                        value={r.capitalAllowances} onChange={v => updateRentalProperty(r.id, 'capitalAllowances', v)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Gross Rent in Republic (€)" hint="col 10"
                        value={r.annualGrossInRepublic} onChange={v => updateRentalProperty(r.id, 'annualGrossInRepublic', v)} />
                      <InputRow label="Gross Rent outside Republic (€)" hint="col 11"
                        value={r.annualGrossOutsideRepublic} onChange={v => updateRentalProperty(r.id, 'annualGrossOutsideRepublic', v)} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Interest Payable (€)" hint="col 13"
                        value={r.interestPayable} onChange={v => updateRentalProperty(r.id, 'interestPayable', v)} />
                      <InputRow label="SDC Withheld by Tenant (€)" hint="col 15"
                        value={r.sdcWithheld} onChange={v => updateRentalProperty(r.id, 'sdcWithheld', v)} />
                      <InputRow label="GHS Withheld by Tenant (€)" hint="col 16"
                        value={r.ghsWithheld} onChange={v => updateRentalProperty(r.id, 'ghsWithheld', v)} />
                    </div>
                  </div>
                ))
              )}
              <button type="button" onClick={addRentalProperty} style={embedded ? TD1.addBtn : { width: '100%', padding: '0.5rem', background: 'transparent', color: COLORS.accent, border: `1px dashed ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.85rem' }}>
                + Add rental property
              </button>

              <div style={TD1.caption}>Part 4.B — Pensions <span style={TD1.captionItalic}>(one row per payer)</span></div>
              {embedded && (
                <div style={TD1.legend}>
                  {PENSION_CODES.map(c => <span key={c.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{c.code}</span>{shortCodeLabel(c.label)}</span>)}
                </div>
              )}
              {embedded ? (
                <div style={TD1.wrap}>
                  <table style={TD1.table}>
                    <thead>
                      <tr style={TD1.thRow}>
                        <th style={{ ...TD1.th, minWidth: 88 }}>(1) T.I.C.</th>
                        <th style={{ ...TD1.th, minWidth: 200 }}>(2) Payer Name</th>
                        <th style={{ ...TD1.th, minWidth: 60 }}>(3) Code</th>
                        <th style={{ ...TD1.thNum, minWidth: 100 }}>(4) Amount</th>
                        <th style={{ ...TD1.thNum, minWidth: 90 }}>(5) Tax W/h</th>
                        <th style={{ ...TD1.thNum, minWidth: 90 }}>(6) GHS W/h</th>
                        <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pensions.map((p) => (
                        <tr key={p.id}>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={p.payerTic} onChange={e => updatePension(p.id, 'payerTic', e.target.value)} placeholder="TIC" /></td>
                          <td style={TD1.td}><input style={TD1.input} type="text" value={p.payerName} onChange={e => updatePension(p.id, 'payerName', e.target.value)} placeholder="e.g. SIS" /></td>
                          <td style={TD1.td}>
                            <select style={TD1.select} value={p.code} onChange={e => updatePension(p.id, 'code', e.target.value)} title={(PENSION_CODES.find(c => c.code === p.code) || {}).label}>
                              {PENSION_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                            </select>
                          </td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.amount} onChange={e => updatePension(p.id, 'amount', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.taxWithheld} onChange={e => updatePension(p.id, 'taxWithheld', e.target.value)} placeholder="0.00" /></td>
                          <td style={TD1.td}><input style={TD1.inputN} type="number" value={p.ghsWithheld} onChange={e => updatePension(p.id, 'ghsWithheld', e.target.value)} placeholder="0.00" /></td>
                          <td style={{ ...TD1.td, textAlign: 'center' }}>
                            <button type="button" onClick={() => removePension(p.id)} style={TD1.removeBtn} title="Remove">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={TD1.tfootRow}>
                        <td colSpan={3} style={TD1.tfootLabel}>TOTAL</td>
                        <td style={TD1.tfootCell}>{fmtSum(pensions.reduce((s, x) => s + Number(x.amount || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(pensions.reduce((s, x) => s + Number(x.taxWithheld || 0), 0))}</td>
                        <td style={TD1.tfootCell}>{fmtSum(pensions.reduce((s, x) => s + Number(x.ghsWithheld || 0), 0))}</td>
                        <td style={TD1.tfootLabel}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                pensions.map((p, idx) => (
                  <div key={p.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: '3px', padding: '0.65rem', marginBottom: '0.65rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: COLORS.accent }}>
                        Pension #{idx + 1}{p.payerName ? ` — ${p.payerName}` : ''}
                      </span>
                      <button type="button" onClick={() => removePension(p.id)}
                        style={{ padding: '0.2rem 0.55rem', background: 'transparent', color: COLORS.danger, border: `1px solid ${COLORS.danger}`, borderRadius: '3px', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit' }}
                        title="Remove this pension">✕ Remove</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Payer Name" type="text" placeholder="e.g. SIS, Foreign Govt"
                        value={p.payerName} onChange={v => updatePension(p.id, 'payerName', v)} />
                      <InputRow label="Payer TIC" type="text" placeholder=""
                        value={p.payerTic} onChange={v => updatePension(p.id, 'payerTic', v)} />
                    </div>
                    <div style={{ marginBottom: '0.7rem' }}>
                      <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Code (TD1 column 3)</label>
                      <select value={p.code} onChange={e => updatePension(p.id, 'code', e.target.value)}
                        style={{ width: '100%', padding: '0.55rem 0.75rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontFamily: 'inherit', fontSize: '0.82rem' }}>
                        {PENSION_CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 0.6rem' }}>
                      <InputRow label="Pension Amount (€)" value={p.amount} onChange={v => updatePension(p.id, 'amount', v)} />
                      <InputRow label="Tax Withheld (€)" value={p.taxWithheld} onChange={v => updatePension(p.id, 'taxWithheld', v)} />
                      <InputRow label="GHS Withheld (€)" value={p.ghsWithheld} onChange={v => updatePension(p.id, 'ghsWithheld', v)} />
                    </div>
                  </div>
                ))
              )}
              <button type="button" onClick={addPension} style={embedded ? TD1.addBtn : { width: '100%', padding: '0.5rem', background: 'transparent', color: COLORS.accent, border: `1px dashed ${COLORS.accent}`, borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.85rem' }}>
                + Add pension
              </button>

              <InputRow label="Other Taxable Income (€)" value={otherIncome} onChange={setOtherIncome} hint="general other income" />

              <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '0.85rem', marginBottom: '0.6rem' }}>Royalties / IP Income</div>
              <InputRow label="Qualifying IP Royalties (€)" value={royaltyIncomeQualifying} onChange={setRoyaltyIncomeQualifying} hint="80% exempt (IP Box)" />
              <InputRow label="Ordinary Royalties (€)" value={royaltyIncomeOrdinary} onChange={setRoyaltyIncomeOrdinary} hint="fully taxable" />

              <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '0.85rem', marginBottom: '0.6rem' }}>Other Income Sources</div>
              <InputRow label="Court Order / Will / Contract (€)" value={courtOrderIncome} onChange={setCourtOrderIncome} hint="alimony, etc." />
              <InputRow label="Trading Goodwill (€)" value={tradingGoodwill} onChange={setTradingGoodwill} hint="one-off goodwill income" />
              <InputRow label="Crypto from Mining (€)" value={capitalGainsCryptoMining} onChange={setCapitalGainsCryptoMining} hint="general PIT (not 8% flat)" />
            </Section>

            {/* SECTION 1B: CAPITAL GAINS (DISPLAY ONLY) */}
            <Section id="capitalgains" title="1B. Capital Gains (Info Only)" icon={Info} isOpen={openSections.capitalgains} onToggle={toggleSection} summary="(not taxable as PIT)">
              <div style={{ marginBottom: '0.85rem', padding: '0.5rem 0.65rem', background: COLORS.bg, borderLeft: `2px solid ${COLORS.success}`, borderRadius: '2px', fontSize: '0.72rem', color: COLORS.textDim, lineHeight: 1.5 }}>
                <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px', color: COLORS.success }} />
                These items are <strong style={{ color: COLORS.success }}>NOT subject to PIT</strong>. Recorded for reference only — separate Capital Gains Tax (CGT) may apply to Cyprus property.
              </div>

              <InputRow label="Capital Gains on Shares/Securities (€)" value={capitalGainsShares} onChange={setCapitalGainsShares} hint="0% — fully exempt" />
              <InputRow label="Capital Gains on Cyprus Property (€)" value={capitalGainsProperty} onChange={setCapitalGainsProperty} hint="separate CGT — 20%" />

              <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.65rem', background: COLORS.bg, borderRadius: '2px', fontSize: '0.7rem', color: COLORS.textDim, lineHeight: 1.5 }}>
                <strong style={{ color: COLORS.text }}>Note:</strong> Cyprus property capital gains are taxed at 20% under separate Capital Gains Tax (Form IR1). Not included in this PIT computation.
              </div>
            </Section>

            <Section id="special" title="2. Special-Rate & Defence" icon={Coins} isOpen={openSections.special} onToggle={toggleSection}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.accent, marginBottom: '0.85rem', cursor: 'pointer', padding: '0.5rem', background: COLORS.bg, borderRadius: '3px', border: `1px solid ${COLORS.accent}` }}>
                <input type="checkbox" checked={isNonDom} onChange={(e) => setIsNonDom(e.target.checked)} />
                <strong>Non-Dom Status</strong> <span style={{ color: COLORS.textDim, fontSize: '0.72rem' }}>(0% SDC)</span>
              </label>

              {/* Public /tax: simple single-field dividend/interest inputs. Portal mode
                  swaps these for the TD1-shaped row arrays below. */}
              {!embedded && (
                <>
                  <InputRow label="Dividend Income (€)" value={dividendIncome} onChange={setDividendIncome}
                    hint={isNonDom ? "0% SDC + 2.65% GHS" : selectedYear === 2025 ? "17% SDC + 2.65% GHS" : "5% SDC + 2.65% GHS"} />
                  <InputRow label="Interest Income (€)" value={interestIncome} onChange={setInterestIncome} hint={isNonDom ? "0% SDC + 2.65% GHS" : "17% SDC + 2.65% GHS"} />
                </>
              )}
              <InputRow label="Crypto Disposal Gains (€)" value={cryptoGains} onChange={setCryptoGains} hint="flat 8%" />

              {embedded && (
                <>
                  <div style={TD1.caption}>Part 4.F — Dividends <span style={TD1.captionItalic}>(one row per company)</span></div>
                  <div style={TD1.legend}>
                    {DIVIDEND_CODES.map(c => <span key={c.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{c.code}</span>{shortCodeLabel(c.label)}</span>)}
                  </div>
                  <div style={TD1.wrap}>
                    <table style={TD1.table}>
                      <thead>
                        <tr style={TD1.thRow}>
                          <th style={{ ...TD1.th, minWidth: 56 }}>(4) Code</th>
                          <th style={{ ...TD1.th, minWidth: 88 }}>(1) TIC</th>
                          <th style={{ ...TD1.th, minWidth: 80 }}>(2) Country</th>
                          <th style={{ ...TD1.th, minWidth: 160 }}>(3) Business Name</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(5) Gross</th>
                          <th style={{ ...TD1.thNum, minWidth: 90 }}>(6) SDC W/h</th>
                          <th style={{ ...TD1.thNum, minWidth: 90 }}>(7) GHS W/h</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(8) Tax Outside</th>
                          <th style={{ ...TD1.th, minWidth: 110 }}>(9) Receipt</th>
                          <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {dividendSources.map((d) => (
                          <tr key={d.id}>
                            <td style={TD1.td}>
                              <select style={TD1.select} value={d.code} onChange={e => updateDividendSource(d.id, 'code', e.target.value)} title={(DIVIDEND_CODES.find(c => c.code === d.code) || {}).label}>
                                {DIVIDEND_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                              </select>
                            </td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={d.payerTic} onChange={e => updateDividendSource(d.id, 'payerTic', e.target.value)} placeholder="TIC" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={d.country} onChange={e => updateDividendSource(d.id, 'country', e.target.value)} placeholder="" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={d.businessName} onChange={e => updateDividendSource(d.id, 'businessName', e.target.value)} placeholder="Company" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={d.grossDividend} onChange={e => updateDividendSource(d.id, 'grossDividend', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={d.sdcWithheld} onChange={e => updateDividendSource(d.id, 'sdcWithheld', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={d.ghsWithheld} onChange={e => updateDividendSource(d.id, 'ghsWithheld', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={d.taxPaidOutside} onChange={e => updateDividendSource(d.id, 'taxPaidOutside', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="date" value={d.receiptDate} onChange={e => updateDividendSource(d.id, 'receiptDate', e.target.value)} /></td>
                            <td style={{ ...TD1.td, textAlign: 'center' }}>
                              <button type="button" onClick={() => removeDividendSource(d.id)} style={TD1.removeBtn} title="Remove">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={TD1.tfootRow}>
                          <td colSpan={4} style={TD1.tfootLabel}>TOTAL</td>
                          <td style={TD1.tfootCell}>{fmtSum(dividendSources.reduce((s, x) => s + Number(x.grossDividend || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(dividendSources.reduce((s, x) => s + Number(x.sdcWithheld || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(dividendSources.reduce((s, x) => s + Number(x.ghsWithheld || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(dividendSources.reduce((s, x) => s + Number(x.taxPaidOutside || 0), 0))}</td>
                          <td colSpan={2} style={TD1.tfootLabel}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button type="button" onClick={addDividendSource} style={TD1.addBtn}>+ Add dividend source</button>

                  <div style={TD1.caption}>Part 4.E — Interest Receivable <span style={TD1.captionItalic}>(one row per source)</span></div>
                  <div style={TD1.legend}>
                    {INTEREST_CODES.map(c => <span key={c.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{c.code}</span>{shortCodeLabel(c.label)}</span>)}
                  </div>
                  <div style={TD1.wrap}>
                    <table style={TD1.table}>
                      <thead>
                        <tr style={TD1.thRow}>
                          <th style={{ ...TD1.th, minWidth: 56 }}>(3) Code</th>
                          <th style={{ ...TD1.th, minWidth: 88 }}>(1) TIC</th>
                          <th style={{ ...TD1.th, minWidth: 180 }}>(2) Debtor / Bank</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(4) Gross</th>
                          <th style={{ ...TD1.thNum, minWidth: 100 }}>(5) Tax Out</th>
                          <th style={{ ...TD1.thNum, minWidth: 80 }}>(6) SDC W/h</th>
                          <th style={{ ...TD1.thNum, minWidth: 80 }}>(7) GHS W/h</th>
                          <th style={{ ...TD1.th, minWidth: 90 }}>Country</th>
                          <th style={{ ...TD1.th, minWidth: 100 }}>Acct. Type</th>
                          <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {interestSources.map((s) => (
                          <tr key={s.id}>
                            <td style={TD1.td}>
                              <select style={TD1.select} value={s.code} onChange={e => updateInterestSource(s.id, 'code', e.target.value)} title={(INTEREST_CODES.find(c => c.code === s.code) || {}).label}>
                                {INTEREST_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                              </select>
                            </td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={s.debtorTic} onChange={e => updateInterestSource(s.id, 'debtorTic', e.target.value)} placeholder="TIC" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={s.debtorName} onChange={e => updateInterestSource(s.id, 'debtorName', e.target.value)} placeholder="e.g. Bank of Cyprus" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={s.grossInterest} onChange={e => updateInterestSource(s.id, 'grossInterest', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={s.taxPaidOutside} onChange={e => updateInterestSource(s.id, 'taxPaidOutside', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={s.sdcWithheld} onChange={e => updateInterestSource(s.id, 'sdcWithheld', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={s.ghsWithheld} onChange={e => updateInterestSource(s.id, 'ghsWithheld', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={s.country} onChange={e => updateInterestSource(s.id, 'country', e.target.value)} placeholder={s.code === '5' ? 'required' : ''} /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={s.accountType} onChange={e => updateInterestSource(s.id, 'accountType', e.target.value)} placeholder={s.code === '5' ? 'e.g. savings' : ''} /></td>
                            <td style={{ ...TD1.td, textAlign: 'center' }}>
                              <button type="button" onClick={() => removeInterestSource(s.id)} style={TD1.removeBtn} title="Remove">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={TD1.tfootRow}>
                          <td colSpan={3} style={TD1.tfootLabel}>TOTAL</td>
                          <td style={TD1.tfootCell}>{fmtSum(interestSources.reduce((s, x) => s + Number(x.grossInterest || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(interestSources.reduce((s, x) => s + Number(x.taxPaidOutside || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(interestSources.reduce((s, x) => s + Number(x.sdcWithheld || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(interestSources.reduce((s, x) => s + Number(x.ghsWithheld || 0), 0))}</td>
                          <td colSpan={3} style={TD1.tfootLabel}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button type="button" onClick={addInterestSource} style={TD1.addBtn}>+ Add interest source</button>

                  <div style={TD1.caption}>Part 4.G — Redemption of Life Insurance Policies <span style={TD1.captionItalic}>(early cancellation only)</span></div>
                  <div style={{ marginBottom: '0.5rem', padding: '0.5rem 0.65rem', background: '#fffbeb', borderLeft: `2px solid #9b861f`, borderRadius: '2px', fontSize: '0.72rem', color: '#5a6478', lineHeight: 1.5 }}>
                    <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px' }} />
                    Cancellation within 3 years adds <strong>30%</strong> of total premiums back to income; 3–6 years adds <strong>20%</strong>; over 6 years adds nothing.
                  </div>
                  <div style={TD1.wrap}>
                    <table style={TD1.table}>
                      <thead>
                        <tr style={TD1.thRow}>
                          <th style={{ ...TD1.th, minWidth: 88 }}>(1) TIC</th>
                          <th style={{ ...TD1.th, minWidth: 200 }}>(2) Insurance Company</th>
                          <th style={{ ...TD1.th, minWidth: 120 }}>(3) Issued</th>
                          <th style={{ ...TD1.th, minWidth: 120 }}>(4) Cancelled</th>
                          <th style={{ ...TD1.thNum, minWidth: 140 }}>(5) Premiums Deducted</th>
                          <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lifeRedemptions.map((r) => (
                          <tr key={r.id}>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={r.insuranceCompanyTic} onChange={e => updateLifeRedemption(r.id, 'insuranceCompanyTic', e.target.value)} placeholder="TIC" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={r.insuranceCompanyName} onChange={e => updateLifeRedemption(r.id, 'insuranceCompanyName', e.target.value)} placeholder="e.g. CNP Asfalistiki" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="date" value={r.issueDate} onChange={e => updateLifeRedemption(r.id, 'issueDate', e.target.value)} /></td>
                            <td style={TD1.td}><input style={TD1.input} type="date" value={r.cancellationDate} onChange={e => updateLifeRedemption(r.id, 'cancellationDate', e.target.value)} /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.premiumsDeducted} onChange={e => updateLifeRedemption(r.id, 'premiumsDeducted', e.target.value)} placeholder="0.00" /></td>
                            <td style={{ ...TD1.td, textAlign: 'center' }}>
                              <button type="button" onClick={() => removeLifeRedemption(r.id)} style={TD1.removeBtn} title="Remove">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={TD1.tfootRow}>
                          <td colSpan={4} style={TD1.tfootLabel}>TOTAL</td>
                          <td style={TD1.tfootCell}>{fmtSum(lifeRedemptions.reduce((s, x) => s + Number(x.premiumsDeducted || 0), 0))}</td>
                          <td style={TD1.tfootLabel}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button type="button" onClick={addLifeRedemption} style={TD1.addBtn}>+ Add life insurance redemption</button>
                </>
              )}

              <div style={{ marginTop: '0.85rem', marginBottom: '0.4rem' }}>
                <label style={{ fontSize: '0.78rem', color: COLORS.textMuted, display: 'block', marginBottom: '0.25rem' }}>Foreign Employee Relief</label>
                <select value={foreignReliefType} onChange={(e) => setForeignReliefType(e.target.value)}
                  style={{ width: '100%', padding: '0.55rem', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: '3px', fontSize: '0.83rem' }}>
                  <option value="none">None</option>
                  <option value="fifty">50% exemption (income &gt; €55K)</option>
                  <option value="twenty">20% exemption (max €8,550)</option>
                </select>
              </div>

              <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '1rem', marginBottom: '0.6rem' }}>90-Day Rule (Foreign Work)</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.6rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={foreignEmployer} onChange={(e) => setForeignEmployer(e.target.checked)} />
                <span>Salary paid by <strong style={{ color: COLORS.text }}>non-Cyprus employer</strong> for work outside Cyprus</span>
              </label>

              {foreignEmployer && (
                <div style={{ paddingLeft: '1rem', borderLeft: `2px solid ${COLORS.borderLight}`, marginBottom: '0.6rem' }}>
                  <InputRow label="Days Worked Abroad" value={daysWorkedAbroad} onChange={setDaysWorkedAbroad} hint="must be > 90 to qualify" />
                  <InputRow label="Total Work Days" value={totalWorkDays} onChange={setTotalWorkDays} hint="default: 260" />
                </div>
              )}

              <div style={{ fontSize: '0.7rem', color: COLORS.textDim, fontStyle: 'italic', lineHeight: 1.5 }}>
                {foreignEmployer && (parseFloat(daysWorkedAbroad) || 0) > 90 ? (
                  <span style={{ color: COLORS.success }}>✓ Qualifies for pro-rata exemption</span>
                ) : foreignEmployer && (parseFloat(daysWorkedAbroad) || 0) > 0 ? (
                  <span style={{ color: COLORS.danger }}>✗ Days abroad ≤ 90 — no exemption</span>
                ) : (
                  <span>Section 36(5): exemption for {'>'} 90 days abroad with non-Cyprus employer</span>
                )}
              </div>
            </Section>

            <Section id="deductions" title="3. Allowable Deductions" icon={FileText} isOpen={openSections.deductions} onToggle={toggleSection}>
              {/* Public /tax: legacy single-field Part 5.C inputs. Portal mode uses the
                  TD1-shaped lifeSiPensionFunds[] row UI further down. */}
              {!embedded && (
                <>
                  <InputRow label="Pension / Provident (€)" value={pensionContrib} onChange={setPensionContrib} hint="max 10%" />
                  <InputRow label="Medical Scheme (€)" value={medicalContrib} onChange={setMedicalContrib} hint={selectedYear === 2026 ? "max 2%" : "max 1.5%"} />
                  <InputRow label="Life Insurance Premium (€)" value={lifeInsurance} onChange={setLifeInsurance} />
                  <InputRow label="Life Sum Assured (€)" value={lifeSumAssured} onChange={setLifeSumAssured} hint="cap at 7%" />
                </>
              )}
              <InputRow label="Donations (€)" value={donations} onChange={setDonations} hint="approved charities (TD1 5.A line 3)" />
              <InputRow label="Prof. Subscriptions (€)" value={profSubscriptions} onChange={setProfSubscriptions} hint="TD1 5.A line 2" />

              {/* B3b: Additional Part 5.A miscellaneous deductions — portal only. The TD1 form
                  has 6 numbered miscellaneous deduction lines; the existing fields above cover
                  lines 2 and 3, and these cover the rest. */}
              {embedded && (
                <>
                  <InputRow label="Trade Union Contributions (€)" value={tradeUnionContrib} onChange={setTradeUnionContrib} hint="TD1 5.A line 1" />
                  <InputRow label="Political Party Donations (€)" value={politicalPartyDonations} onChange={setPoliticalPartyDonations} hint="TD1 5.A line 5 — max €50,000" />
                  <InputRow label="Broader Public Sector Reductions (€)" value={broaderPublicSectorReduction} onChange={setBroaderPublicSectorReduction} hint="TD1 5.A line 4 — salary/wage reductions" />
                  <InputRow label="Community / Customs Officer Expenses (€)" value={communityOfficerExpenses} onChange={setCommunityOfficerExpenses} hint="TD1 5.A line 6 — 5/10/20% of commissions" />
                </>
              )}

              <InputRow label="Losses c/f (€)" value={lossesCarriedForward} onChange={setLossesCarriedForward} hint={`${Y.lossCarryForward}-yr c/f`} />

              <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '1rem', marginBottom: '0.6rem' }}>Self-Employed Deductions</div>
              <InputRow label="Capital Allowances (€)" value={capitalAllowances} onChange={setCapitalAllowances} hint="plant/machinery/vehicles" />
              <InputRow label="Bad Debt Provisions (€)" value={badDebts} onChange={setBadDebts} hint="written-off receivables" />

              {/* Rental property deductions are now captured per-property in
                  the Income section's Rental Properties block (TD1 Part 4.C). */}

              {embedded && (
                <>
                  <div style={TD1.caption}>Part 5.C — Life / Social Insurance / Pension Funds <span style={TD1.captionItalic}>(one row per fund/policy)</span></div>
                  <div style={TD1.legend}>
                    {LIFE_SI_PENSION_CODES.map(c => <span key={c.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{c.code}</span>{shortCodeLabel(c.label)}</span>)}
                  </div>
                  <div style={{ marginBottom: '0.5rem', padding: '0.5rem 0.65rem', background: '#fffbeb', borderLeft: `2px solid #9b861f`, borderRadius: '2px', fontSize: '0.72rem', color: '#5a6478', lineHeight: 1.5 }}>
                    <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px' }} />
                    Pension funds (codes 1+5+6) capped at 10% of employment; life policies (code 3) capped at 7% of sum assured per policy; medical (code 4) at {selectedYear === 2026 ? '2%' : '1.5%'} of gross. Code 2 (SIS) is for completeness only — already auto-computed.
                  </div>
                  <div style={TD1.wrap}>
                    <table style={TD1.table}>
                      <thead>
                        <tr style={TD1.thRow}>
                          <th style={{ ...TD1.th, minWidth: 56 }}>(3) Code</th>
                          <th style={{ ...TD1.th, minWidth: 88 }}>(1) TIC</th>
                          <th style={{ ...TD1.th, minWidth: 200 }}>(2) Fund / Insurer</th>
                          <th style={{ ...TD1.th, minWidth: 110 }}>(4) Policy Date</th>
                          <th style={{ ...TD1.th, minWidth: 80 }}>(5) Life of</th>
                          <th style={{ ...TD1.thNum, minWidth: 110 }}>(6) Sum Assured</th>
                          <th style={{ ...TD1.thNum, minWidth: 110 }}>(7) Amount Paid</th>
                          <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lifeSiPensionFunds.map((r) => (
                          <tr key={r.id}>
                            <td style={TD1.td}>
                              <select style={TD1.select} value={r.code} onChange={e => updateLifeSiPensionFund(r.id, 'code', e.target.value)} title={(LIFE_SI_PENSION_CODES.find(c => c.code === r.code) || {}).label}>
                                {LIFE_SI_PENSION_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                              </select>
                            </td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={r.fundTic} onChange={e => updateLifeSiPensionFund(r.id, 'fundTic', e.target.value)} placeholder="TIC" /></td>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={r.fundName} onChange={e => updateLifeSiPensionFund(r.id, 'fundName', e.target.value)} placeholder="e.g. CNP / Provident Fund" /></td>
                            <td style={TD1.td}>
                              {r.code === '3'
                                ? <input style={TD1.input} type="date" value={r.policyDate} onChange={e => updateLifeSiPensionFund(r.id, 'policyDate', e.target.value)} />
                                : <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>—</span>}
                            </td>
                            <td style={TD1.td}>
                              {r.code === '3'
                                ? <select style={TD1.select} value={r.lifeOf} onChange={e => updateLifeSiPensionFund(r.id, 'lifeOf', e.target.value)}>
                                    <option value="own">Own</option>
                                    <option value="spouse">Spouse</option>
                                  </select>
                                : <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>—</span>}
                            </td>
                            <td style={TD1.td}>
                              {r.code === '3'
                                ? <input style={TD1.inputN} type="number" value={r.sumAssured} onChange={e => updateLifeSiPensionFund(r.id, 'sumAssured', e.target.value)} placeholder="0.00" />
                                : <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>—</span>}
                            </td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.amountPaid} onChange={e => updateLifeSiPensionFund(r.id, 'amountPaid', e.target.value)} placeholder="0.00" /></td>
                            <td style={{ ...TD1.td, textAlign: 'center' }}>
                              <button type="button" onClick={() => removeLifeSiPensionFund(r.id)} style={TD1.removeBtn} title="Remove">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={TD1.tfootRow}>
                          <td colSpan={5} style={TD1.tfootLabel}>TOTAL</td>
                          <td style={TD1.tfootCell}>{fmtSum(lifeSiPensionFunds.filter(r => r.code === '3').reduce((s, x) => s + Number(x.sumAssured || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(lifeSiPensionFunds.reduce((s, x) => s + Number(x.amountPaid || 0), 0))}</td>
                          <td style={TD1.tfootLabel}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button type="button" onClick={addLifeSiPensionFund} style={TD1.addBtn}>+ Add fund / policy</button>

                  <div style={TD1.caption}>Part 5.B — Investment in Innovative Businesses <span style={TD1.captionItalic}>(codes 1-4)</span></div>
                  <div style={TD1.legend}>
                    {INNOVATIVE_INVESTMENT_CODES.map(c => <span key={c.code} style={TD1.legendItem}><span style={TD1.legendBadge}>{c.code}</span>{shortCodeLabel(c.label)}</span>)}
                  </div>
                  <div style={{ marginBottom: '0.5rem', padding: '0.5rem 0.65rem', background: '#fffbeb', borderLeft: `2px solid #9b861f`, borderRadius: '2px', fontSize: '0.72rem', color: '#5a6478', lineHeight: 1.5 }}>
                    <Info size={11} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: '-1px' }} />
                    Claim capped at <strong>50% of taxable income</strong> after all other deductions. For continuation investments, add multiple rows with the same TIC.
                  </div>
                  <div style={TD1.wrap}>
                    <table style={TD1.table}>
                      <thead>
                        <tr style={TD1.thRow}>
                          <th style={{ ...TD1.th, minWidth: 88 }}>(1) TIC</th>
                          <th style={{ ...TD1.thNum, minWidth: 80 }}>(2) Yr Inv.</th>
                          <th style={{ ...TD1.thNum, minWidth: 80 }}>(3) Yr Cont.</th>
                          <th style={{ ...TD1.th, minWidth: 56 }}>(4) Code</th>
                          <th style={{ ...TD1.thNum, minWidth: 110 }}>(5) Initial</th>
                          <th style={{ ...TD1.thNum, minWidth: 110 }}>(6) ≤2023</th>
                          <th style={{ ...TD1.thNum, minWidth: 130 }}>(7) Claim This Year</th>
                          <th style={{ ...TD1.th, minWidth: 32, padding: '0.4rem 0.3rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {innovativeInvestments.map((r) => (
                          <tr key={r.id}>
                            <td style={TD1.td}><input style={TD1.input} type="text" value={r.tic} onChange={e => updateInnovativeInvestment(r.id, 'tic', e.target.value)} placeholder="TIC" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.yearOfInvestment} onChange={e => updateInnovativeInvestment(r.id, 'yearOfInvestment', e.target.value)} placeholder="2024" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.yearOfContinuationInvestment} onChange={e => updateInnovativeInvestment(r.id, 'yearOfContinuationInvestment', e.target.value)} placeholder="" /></td>
                            <td style={TD1.td}>
                              <select style={TD1.select} value={r.code} onChange={e => updateInnovativeInvestment(r.id, 'code', e.target.value)} title={(INNOVATIVE_INVESTMENT_CODES.find(c => c.code === r.code) || {}).label}>
                                {INNOVATIVE_INVESTMENT_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                              </select>
                            </td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.initialAmount} onChange={e => updateInnovativeInvestment(r.id, 'initialAmount', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.amountClaimedUpTo2023} onChange={e => updateInnovativeInvestment(r.id, 'amountClaimedUpTo2023', e.target.value)} placeholder="0.00" /></td>
                            <td style={TD1.td}><input style={TD1.inputN} type="number" value={r.amountToClaim} onChange={e => updateInnovativeInvestment(r.id, 'amountToClaim', e.target.value)} placeholder="0.00" /></td>
                            <td style={{ ...TD1.td, textAlign: 'center' }}>
                              <button type="button" onClick={() => removeInnovativeInvestment(r.id)} style={TD1.removeBtn} title="Remove">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={TD1.tfootRow}>
                          <td colSpan={4} style={TD1.tfootLabel}>TOTAL</td>
                          <td style={TD1.tfootCell}>{fmtSum(innovativeInvestments.reduce((s, x) => s + Number(x.initialAmount || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(innovativeInvestments.reduce((s, x) => s + Number(x.amountClaimedUpTo2023 || 0), 0))}</td>
                          <td style={TD1.tfootCell}>{fmtSum(innovativeInvestments.reduce((s, x) => s + Number(x.amountToClaim || 0), 0))}</td>
                          <td style={TD1.tfootLabel}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button type="button" onClick={addInnovativeInvestment} style={TD1.addBtn}>+ Add innovative business investment</button>
                </>
              )}

              {(hasDisability || hasDisabledDependant) && (
                <>
                  <div style={{ fontSize: '0.72rem', color: COLORS.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '1rem', marginBottom: '0.6rem' }}>Disability</div>
                  <InputRow label="Disability-Related Expenses (€)" value={disabilityAllowance} onChange={setDisabilityAllowance} hint="qualifying expenses" />
                </>
              )}
            </Section>

            {(selectedYear === 2026 || comparisonMode) && (
              <Section id="allowances" title="4. New 2026 Allowances" icon={Users} isOpen={openSections.allowances} onToggle={toggleSection}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <InputRow label="Children (under 18)" value={numChildren} onChange={(v) => setNumChildren(parseInt(v) || 0)} placeholder="0" />
                  <InputRow label="Students (18-24)" value={numStudents} onChange={(v) => setNumStudents(parseInt(v) || 0)} placeholder="0" />
                </div>
                <InputRow label="Mortgage / Rent (Primary) (€)" value={mortgageOrRent} onChange={setMortgageOrRent} hint="max €2,000" />
                <InputRow label="Green Investment (€)" value={greenSpend} onChange={setGreenSpend} hint="max €1,000" />
                <InputRow label="Home Insurance (€)" value={homeInsurance} onChange={setHomeInsurance} hint="max €500" />
                {(numChildren + numStudents) > 0 && (
                  <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.65rem', background: COLORS.bg, borderLeft: `2px solid ${results2026.eligibleFamily ? COLORS.success : COLORS.danger}`, borderRadius: '2px', fontSize: '0.7rem', color: COLORS.textDim, lineHeight: 1.5 }}>
                    <strong style={{ color: results2026.eligibleFamily ? COLORS.success : COLORS.danger }}>
                      {results2026.eligibleFamily ? '✓ Eligible' : '✗ Not eligible'}
                    </strong> · Threshold: {fmt(results2026.familyThreshold)}
                  </div>
                )}
              </Section>
            )}
          </div>

          {comparisonMode ? (
            <>
              <ComputationPanel results={results2025} year={2025} isComparison={true} Y={TAX_YEARS[2025]} />
              <ComputationPanel results={results2026} year={2026} isComparison={true} Y={TAX_YEARS[2026]} />
            </>
          ) : (
            <ComputationPanel results={activeResults} year={selectedYear} Y={Y} />
          )}
        </div>

        {comparisonMode && results2025.totalGrossIncome > 0 && (
          <div className="fade-in" style={{ marginTop: '1rem', padding: '1.25rem', background: COLORS.card, border: `2px solid ${COLORS.accent}`, borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', color: COLORS.accent, textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: 600 }}>
              2025 vs 2026 Comparison
            </div>
            <div className="serif" style={{ fontSize: '1.5rem', fontWeight: 600, color: delta >= 0 ? COLORS.success : COLORS.danger, marginBottom: '0.4rem' }}>
              {delta >= 0 ? '+' : ''}{fmt(delta)} {delta >= 0 ? 'better off in 2026' : 'worse off in 2026'}
            </div>
            <div style={{ fontSize: '0.85rem', color: COLORS.textMuted }}>
              {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(2)}% change in net take-home ·
              Total tax saving: {fmt(results2025.totalLiability - results2026.totalLiability)}
            </div>
          </div>
        )}

        {/* Marketing footer — public /tax only. */}
        {!embedded && (
          <div style={{ marginTop: '1.25rem', padding: '0.85rem', background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '4px', fontSize: '0.7rem', color: COLORS.textDim, lineHeight: 1.6 }}>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.15em', color: COLORS.accent, textTransform: 'uppercase', marginBottom: '0.4rem', fontWeight: 600 }}>
              ✓ Verified against Cyprus MOF official tax calculator (taxtools.mof.gov.cy)
            </div>
            <div style={{ fontStyle: 'italic', fontSize: '0.66rem' }}>
              Stage 1 + PDF Export. Indicative only — verify against official Cyprus Tax Department guidance before filing.
            </div>
          </div>
        )}
      </div>
    </div>
    </EmbeddedContext.Provider>
  );
}
