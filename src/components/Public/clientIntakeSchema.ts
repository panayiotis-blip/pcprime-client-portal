// Schema for the public client onboarding / annual-refresh questionnaire.
// Deliberately comprehensive — we want the client to complete as much as
// possible; staff fill any gaps at review. Sections/fields mirror the internal
// client model (see services/smartImport/fields.ts) plus Employment & KYC/AML.
//
// `when` hides a section/field unless the predicate passes (e.g. employment
// questions only for individuals). Repeatable sections collect a list (e.g.
// employers, directors) into payload[key] as an array.

export type IntakeFieldType =
  | 'text' | 'email' | 'tel' | 'date' | 'number' | 'select' | 'textarea' | 'checkbox';

export interface IntakeField {
  key: string;
  label: string;
  type: IntakeFieldType;
  options?: string[];           // for select
  placeholder?: string;
  help?: string;
  when?: (form: Record<string, any>) => boolean;
  half?: boolean;               // render two-per-row
}

export interface IntakeSection {
  id: string;
  title: string;
  description?: string;
  when?: (form: Record<string, any>) => boolean;
  fields?: IntakeField[];
  // Repeatable list of sub-records (e.g. employers). Stored as form[listKey] = [].
  repeatable?: { listKey: string; itemLabel: string; addLabel: string; fields: IntakeField[] };
}

const CATEGORIES = ['Individual', 'Self-employed', 'Company', 'Partnership', 'Other'];
const isIndividual = (f: Record<string, any>) =>
  ['Individual', 'Self-employed'].includes(f.client_category) || !f.client_category;
const isCompanyLike = (f: Record<string, any>) =>
  ['Company', 'Partnership'].includes(f.client_category);
const isEmployedish = (f: Record<string, any>) =>
  ['Employed', 'Both employed & self-employed'].includes(f.employment_status);
const isSelfEmployedish = (f: Record<string, any>) =>
  ['Self-employed', 'Both employed & self-employed'].includes(f.employment_status) ||
  f.client_category === 'Self-employed';
const isMarriedish = (f: Record<string, any>) =>
  ['Married', 'Civil partnership'].includes(f.marital_status);

export const INTAKE_SECTIONS: IntakeSection[] = [
  {
    id: 'about',
    title: 'About you',
    description: 'Tell us who this return is for.',
    fields: [
      { key: 'client_category', label: 'You are a…', type: 'select', options: CATEGORIES, half: true },
      { key: 'name', label: 'Full name / Legal name', type: 'text' },
      { key: 'name_tax_office', label: 'Name in Greek (as per Tax Department)', type: 'text' },
      { key: 'trading_name', label: 'Trading name', type: 'text', when: isCompanyLike, half: true },
      { key: 'id_number', label: 'ID card number', type: 'text', half: true, when: isIndividual },
      { key: 'passport_number', label: 'Passport number', type: 'text', half: true, when: isIndividual },
      { key: 'date_of_birth', label: 'Date of birth', type: 'date', half: true, when: isIndividual },
      { key: 'nationality', label: 'Nationality', type: 'text', half: true, when: isIndividual },
      { key: 'registration_number', label: 'Registration (HE) number', type: 'text', half: true, when: isCompanyLike },
      { key: 'incorporation_date', label: 'Incorporation date', type: 'date', half: true, when: isCompanyLike },
    ],
  },
  {
    id: 'contact',
    title: 'Contact details',
    fields: [
      { key: 'phone', label: 'Phone', type: 'tel', half: true },
      { key: 'mobile', label: 'Mobile', type: 'tel', half: true },
      { key: 'email', label: 'Email', type: 'email', half: true },
      { key: 'website', label: 'Website', type: 'text', half: true, when: isCompanyLike },
      { key: 'contact_person', label: 'Main contact person', type: 'text', when: isCompanyLike },
    ],
  },
  {
    id: 'address',
    title: 'Address',
    description: 'Your residential address (or registered office for a company).',
    fields: [
      { key: 'addr_line1', label: 'Address line 1', type: 'text' },
      { key: 'addr_line2', label: 'Address line 2', type: 'text' },
      { key: 'addr_city', label: 'City / town', type: 'text', half: true },
      { key: 'addr_postal', label: 'Postal code', type: 'text', half: true },
      { key: 'addr_country', label: 'Country', type: 'text', half: true, placeholder: 'Cyprus' },
    ],
  },
  {
    id: 'registrations',
    title: 'Tax & registrations',
    fields: [
      { key: 'tax_number', label: 'Tax Identification Code (TIC)', type: 'text', half: true },
      { key: 'vat_number', label: 'VAT number (if registered)', type: 'text', half: true },
      { key: 'vat_registration_date', label: 'VAT registration date', type: 'date', half: true, when: (f) => !!f.vat_number },
      { key: 'social_insurance_number', label: 'Social Insurance number', type: 'text', half: true, when: isIndividual },
      { key: 'employer_number', label: 'SI employer number (if you employ staff)', type: 'text', half: true },
      { key: 'ergani_number', label: 'Ergani number (if you employ staff)', type: 'text', half: true },
      { key: 'tax_residency_country', label: 'Country of tax residence', type: 'text', half: true, placeholder: 'Cyprus' },
    ],
  },
  {
    id: 'family',
    title: 'Family',
    description: 'Helps us apply the right allowances and reliefs.',
    when: isIndividual,
    fields: [
      { key: 'marital_status', label: 'Marital status', type: 'select',
        options: ['Single', 'Married', 'Civil partnership', 'Divorced', 'Widowed'], half: true },
      { key: 'spouse_name', label: "Spouse / partner's name", type: 'text', half: true, when: isMarriedish },
      { key: 'spouse_tic', label: "Spouse / partner's TIC", type: 'text', half: true, when: isMarriedish },
      { key: 'num_dependants', label: 'Number of dependent children', type: 'number', half: true },
      { key: 'dependants_notes', label: 'Notes on dependants (ages, studying, etc.)', type: 'textarea',
        when: (f) => Number(f.num_dependants) > 0 },
    ],
  },
  {
    id: 'employment',
    title: 'Employment & income',
    description: 'So we capture all your income sources for the tax return.',
    when: isIndividual,
    fields: [
      { key: 'employment_status', label: 'Current employment status', type: 'select',
        options: ['Employed', 'Self-employed', 'Both employed & self-employed', 'Pensioner', 'Unemployed', 'Student', 'Other'] },
      { key: 'self_emp_activity', label: 'Self-employed activity / profession', type: 'text', when: isSelfEmployedish },
      { key: 'self_emp_turnover', label: 'Estimated annual turnover (€)', type: 'number', when: isSelfEmployedish, half: true },
      // "other income" flags — quick checkboxes so we know what to ask for.
      { key: 'has_rental_income', label: 'I receive rental income', type: 'checkbox' },
      { key: 'has_dividends', label: 'I receive dividends', type: 'checkbox' },
      { key: 'has_interest', label: 'I receive interest', type: 'checkbox' },
      { key: 'has_foreign_income', label: 'I have income from outside Cyprus', type: 'checkbox' },
      { key: 'income_notes', label: 'Anything else about your income', type: 'textarea' },
    ],
  },
  {
    id: 'employers',
    title: 'Employer(s)',
    description: 'List each employer you had during the year.',
    when: (f) => isIndividual(f) && isEmployedish(f),
    repeatable: {
      listKey: 'employers', itemLabel: 'Employer', addLabel: '+ Add another employer',
      fields: [
        { key: 'employer_name', label: 'Employer name', type: 'text' },
        { key: 'employer_tic', label: "Employer's TIC", type: 'text', half: true },
        { key: 'position', label: 'Job title / position', type: 'text', half: true },
        { key: 'start_date', label: 'Employed since', type: 'date', half: true },
        { key: 'gross_annual', label: 'Gross annual salary (€)', type: 'number', half: true },
        { key: 'still_employed', label: 'Still employed here', type: 'checkbox' },
      ],
    },
  },
  {
    id: 'pensions',
    title: 'Pension(s)',
    when: (f) => isIndividual(f) && ['Pensioner', 'Both employed & self-employed', 'Employed'].includes(f.employment_status),
    repeatable: {
      listKey: 'pensions', itemLabel: 'Pension', addLabel: '+ Add a pension',
      fields: [
        { key: 'payer', label: 'Pension payer', type: 'text' },
        { key: 'type', label: 'Type (state, occupational, overseas…)', type: 'text', half: true },
        { key: 'annual_amount', label: 'Annual amount (€)', type: 'number', half: true },
      ],
    },
  },
  {
    id: 'directors',
    title: 'Directors, shareholders & officers',
    description: 'List each director, shareholder, company secretary and beneficial owner. Tick every role that applies to each person.',
    when: isCompanyLike,
    repeatable: {
      listKey: 'directors', itemLabel: 'Person', addLabel: '+ Add director / shareholder',
      fields: [
        { key: 'name', label: 'Full name', type: 'text' },
        { key: 'date_of_birth', label: 'Date of birth', type: 'date', half: true },
        { key: 'nationality', label: 'Nationality', type: 'text', half: true },
        { key: 'id_number', label: 'ID / passport number', type: 'text', half: true },
        { key: 'tic', label: 'Tax Identification Code (TIC)', type: 'text', half: true },
        { key: 'shareholding', label: 'Shareholding %', type: 'number', half: true },
        // Role(s) — tick all that apply; mirror the client_directors flags.
        { key: 'is_director', label: 'Director', type: 'checkbox', half: true },
        { key: 'is_shareholder', label: 'Shareholder', type: 'checkbox', half: true },
        { key: 'is_secretary', label: 'Company secretary', type: 'checkbox', half: true },
        { key: 'is_signatory', label: 'Authorised signatory', type: 'checkbox', half: true },
        { key: 'is_ubo', label: 'Ultimate beneficial owner (UBO)', type: 'checkbox', half: true },
      ],
    },
  },
  {
    id: 'bank',
    title: 'Bank details',
    description: 'Used for tax refunds and payments. Optional, but it saves time later.',
    fields: [
      { key: 'bank_name', label: 'Bank name', type: 'text', half: true },
      { key: 'bank_iban', label: 'IBAN', type: 'text', half: true, placeholder: 'CY00 0000 0000 0000 0000 0000 0000' },
      { key: 'bank_swift', label: 'SWIFT / BIC', type: 'text', half: true },
    ],
  },
  {
    id: 'kyc',
    title: 'Compliance (KYC / AML)',
    description: 'Required of us as regulated accountants. Your details are kept confidential. Your ID / passport number is taken from the details you gave above.',
    fields: [
      { key: 'id_doc_expiry', label: 'ID / passport expiry date', type: 'date', half: true, when: isIndividual, help: 'Expiry of the ID card or passport you entered above.' },
      { key: 'source_of_funds', label: 'Main source of funds / income', type: 'select',
        options: ['Employment', 'Business / self-employment', 'Pension', 'Investments', 'Rental', 'Inheritance / gift', 'Savings', 'Other'], half: true },
      { key: 'source_of_wealth', label: 'Source of wealth (brief description)', type: 'textarea' },
      { key: 'is_pep', label: 'I (or a close associate) am a politically exposed person (PEP)', type: 'checkbox' },
      { key: 'pep_details', label: 'PEP details', type: 'textarea', when: (f) => !!f.is_pep },
    ],
  },
  {
    id: 'notes',
    title: 'Anything else',
    fields: [
      { key: 'previous_accountant', label: 'Previous accountant / firm (if any)', type: 'text', half: true },
      { key: 'previous_accountant_contact', label: 'Their contact (for handover)', type: 'text', half: true },
      { key: 'notes', label: 'Notes for us', type: 'textarea' },
    ],
  },
];

// Visible sections for the current form state.
export const visibleSections = (form: Record<string, any>): IntakeSection[] =>
  INTAKE_SECTIONS.filter((s) => !s.when || s.when(form));
