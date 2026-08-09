import { TagTone } from '../components/Tag';

/** A status label as it appears on a card, with the tone that carries it. */
export type Status = { label: string; tone: TagTone };

export type DocumentKind = 'PDF' | 'CSV' | 'ZIP' | 'XLS';

export type DocumentCategory = 'Invoices' | 'Bank' | 'Payroll' | 'Filings';

export type ClientDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  /** One line of provenance: source, date, size. */
  meta: string;
  status: Status;
  category: DocumentCategory;
};

/**
 * How far along a filing is. The bar's colour is a consequence of this, not a
 * free choice: done is deep gold, live work is gold, anything dormant is
 * neutral.
 */
export type FilingProgress = 'filed' | 'in-progress' | 'idle';

export type Filing = {
  id: string;
  title: string;
  /** "Due 10 August 2026" or "Filed 10 May 2026". */
  due: string;
  status: Status;
  percent: number;
  progress: FilingProgress;
};

/** A row in Home's calendar card. */
export type Deadline = {
  id: string;
  day: string;
  month: string;
  title: string;
  sub: string;
  status: Status;
};

export type Service = { name: string; description: string };

export type SiteLink = { label: string; href: string; host: string };

export type Message = { id: string; from: 'me' | 'them'; text: string };

/** Which tab set and which screens the signed-in user gets. */
export type Role = 'client' | 'staff';

/** A line on a client's open-items list. */
export type ClientItem = { id: string; title: string; sub: string; status: Status };

export type Client = {
  id: string;
  name: string;
  /** Two letters for the framed tile. */
  initials: string;
  /** "Ltd · Wholesale" — entity type and sector. */
  type: string;
  /** VAT or TIC number. */
  vat: string;
  status: Status;
  /** "client since 2019" — shown on the staff message header. */
  since: string;
  /** Unbilled amount, pre-formatted. */
  fee: string;
  feeNote: string;
  items: ClientItem[];
};

export type StaffTask = { id: string; title: string; sub: string; done: boolean };

/** A client the accountant needs to chase, and what for. */
export type ChaseTarget = { id: string; clientId: string; name: string; initials: string; need: string };

export type StaffStat = { value: string; label: string };
