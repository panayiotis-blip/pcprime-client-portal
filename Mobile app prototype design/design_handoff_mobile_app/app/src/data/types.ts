import { TagTone } from '../components/Tag';

/** A status label as it appears on a card, with the tone that carries it. */
export type Status = { label: string; tone: TagTone };

/**
 * The short label in the 34×42 file box. Usually the extension, uppercased —
 * the design shows PDF/CSV/ZIP/XLS but the portal accepts more than that.
 */
export type DocumentKind = string;

export type ClientDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  /** One line of provenance: category and date. */
  meta: string;
  status: Status;
  category: string;
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

/** The gold card at the top of Home: the one thing most worth knowing. */
export type Alert = { title: string; sub: string } | null;

export type Service = { name: string; description: string };

export type SiteLink = { label: string; href: string; host: string };

export type Message = { id: string; from: 'me' | 'them'; text: string };

/** Which tab set and which screens the signed-in user gets. */
export type Role = 'client' | 'staff';

/** The signed-in user, as the app needs them. */
export type Account = {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: Role;
  /** Clients this user is linked to. A client user normally has exactly one. */
  clientIds: number[];
};

/** The client whose portal we are looking at. */
export type Profile = {
  id: number;
  name: string;
  /** "VAT 10234567X" or "TIC 4471203", whichever the record carries. */
  taxLabel: string;
};

/** A bookable consultation time. */
export type Slot = {
  /** ISO timestamp — what the booking RPC wants back. */
  iso: string;
  /** Local day key, for grouping the day scroller. */
  dayKey: string;
  dow: string;
  dayNumber: number;
  /** "Friday 7 August" — the confirmation summary. */
  dayLabel: string;
  /** "09:30". */
  time: string;
};

/** A line on a client's open-items list. */
export type ClientItem = { id: string; title: string; sub: string; status: Status };

export type Client = {
  id: string;
  name: string;
  initials: string;
  /** Business type, or "Client" when the record does not say. */
  type: string;
  /** VAT or TIC number. */
  vat: string;
  status: Status;
  /** "client since 2019" — shown on the staff message header. */
  since: string;
  /** Pre-formatted fee amount. */
  fee: string;
  feeNote: string;
  items: ClientItem[];
};

export type StaffTask = { id: string; title: string; sub: string; done: boolean };

/** A client the accountant needs to chase, and what for. */
export type ChaseTarget = { id: string; clientId: string; name: string; initials: string; need: string };

export type StaffStat = { value: string; label: string };
