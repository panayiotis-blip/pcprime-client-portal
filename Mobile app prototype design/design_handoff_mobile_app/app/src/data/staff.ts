/**
 * Staff-mode mock content, transcribed from the design handoff.
 *
 * As with `./mock`, all of this stands in for the portal API — see
 * `src/api/portal.ts`.
 */

import { ChaseTarget, Client, StaffStat, StaffTask } from './types';

/** The signed-in accountant. */
export const staffProfile = {
  name: 'Christina Prodromou',
  initials: 'CP',
  role: 'Senior accountant',
  firm: 'Prime & Calculate',
} as const;

export const staffStats: StaffStat[] = [
  { value: '12', label: 'VAT filings this week' },
  { value: '5', label: 'Clients missing docs' },
];

export const staffTasks: StaffTask[] = [
  { id: 't1', title: 'Review Mediterra VAT workings', sub: 'Q2 2026 · 20 min', done: false },
  { id: 't2', title: 'Chase Nicolaou & Sons — Q1 overdue', sub: '22 days late', done: false },
  {
    id: 't3',
    title: 'Send engagement letter to E. Papadopoulou',
    sub: 'Onboarding',
    done: true,
  },
  { id: 't4', title: 'File July payroll — 4 clients', sub: 'Due today', done: false },
];

export const chasing: ChaseTarget[] = [
  {
    id: 'c1',
    clientId: 'kyr',
    initials: 'KT',
    name: 'Kyriakou Trading',
    need: '3 purchase invoices · VAT Q2',
  },
  {
    id: 'c2',
    clientId: 'nic',
    initials: 'NS',
    name: 'Nicolaou & Sons',
    need: 'Q1 VAT overdue 22 days',
  },
  {
    id: 'c3',
    clientId: 'ele',
    initials: 'EP',
    name: 'E. Papadopoulou',
    need: 'Engagement letter unsigned',
  },
];

export const clients: Client[] = [
  {
    id: 'kyr',
    name: 'Kyriakou Trading Ltd',
    initials: 'KT',
    type: 'Ltd · Wholesale',
    vat: 'VAT 10234567X',
    status: { label: 'VAT due', tone: 'action' },
    since: 'Andreas Kyriakou · client since 2019',
    fee: '€480',
    feeNote: 'Q2 retainer, unbilled',
    items: [
      {
        id: 'kyr-1',
        title: 'VAT return Q2 2026',
        sub: 'Due 10 Aug',
        status: { label: 'Missing 3 invoices', tone: 'action' },
      },
      {
        id: 'kyr-2',
        title: 'Payroll — July',
        sub: '8 employees',
        status: { label: 'Filed', tone: 'positive' },
      },
      {
        id: 'kyr-3',
        title: 'Management accounts',
        sub: 'June',
        status: { label: 'In review', tone: 'action' },
      },
    ],
  },
  {
    id: 'ath',
    name: 'Athina Georgiou',
    initials: 'AG',
    type: 'Sole trader · Design',
    vat: 'TIC 4471203',
    status: { label: 'Clear', tone: 'positive' },
    since: 'Athina Georgiou · client since 2021',
    fee: '€180',
    feeNote: 'Annual return, paid',
    items: [
      {
        id: 'ath-1',
        title: 'Personal income tax 2025',
        sub: 'Submitted 14 Jun',
        status: { label: 'Filed', tone: 'positive' },
      },
      {
        id: 'ath-2',
        title: 'Social insurance',
        sub: 'Q2',
        status: { label: 'Filed', tone: 'positive' },
      },
    ],
  },
  {
    id: 'med',
    name: 'Mediterra Foods Ltd',
    initials: 'MF',
    type: 'Ltd · F&B',
    vat: 'VAT 10998231Z',
    status: { label: 'Audit', tone: 'inert' },
    since: 'Marios Loizou · client since 2016',
    fee: '€1,250',
    feeNote: 'Audit engagement 2025',
    items: [
      {
        id: 'med-1',
        title: 'Statutory audit 2025',
        sub: 'Fieldwork week 3',
        status: { label: 'In progress', tone: 'action' },
      },
      {
        id: 'med-2',
        title: 'VAT return Q2 2026',
        sub: 'Due 10 Aug',
        status: { label: 'Ready', tone: 'positive' },
      },
    ],
  },
  {
    id: 'nic',
    name: 'Nicolaou & Sons',
    initials: 'NS',
    type: 'Partnership · Construction',
    vat: 'VAT 10553402K',
    status: { label: 'Overdue', tone: 'action' },
    since: 'Petros Nicolaou · client since 2012',
    fee: '€620',
    feeNote: '2 invoices outstanding',
    items: [
      {
        id: 'nic-1',
        title: 'VAT return Q1 2026',
        sub: 'Overdue 22 days',
        status: { label: 'Overdue', tone: 'action' },
      },
      {
        id: 'nic-2',
        title: 'Payroll — July',
        sub: '23 employees',
        status: { label: 'Filed', tone: 'positive' },
      },
    ],
  },
  {
    id: 'blu',
    name: 'Blue Harbour Rentals',
    initials: 'BH',
    type: 'Ltd · Property',
    vat: 'VAT 10771190B',
    status: { label: 'Clear', tone: 'positive' },
    since: 'Maria Christodoulou · client since 2020',
    fee: '€340',
    feeNote: 'Monthly bookkeeping',
    items: [
      {
        id: 'blu-1',
        title: 'Bookkeeping — July',
        sub: 'Reconciled 2 Aug',
        status: { label: 'Done', tone: 'positive' },
      },
    ],
  },
  {
    id: 'ele',
    name: 'Elena Papadopoulou',
    initials: 'EP',
    type: 'Sole trader · Consulting',
    vat: 'TIC 5590188',
    status: { label: 'New', tone: 'inert' },
    since: 'Elena Papadopoulou · client since 2026',
    fee: '—',
    feeNote: 'Onboarding',
    items: [
      {
        id: 'ele-1',
        title: 'Engagement letter',
        sub: 'Sent 1 Aug',
        status: { label: 'Awaiting', tone: 'action' },
      },
    ],
  },
];

/** The thread the Messages tab opens on when no client was chosen. */
export const defaultThreadClientId = 'kyr';
