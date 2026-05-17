// =============================================================
// Smart Import — importable client field registry + auto-matcher.
// Shared by every phase of the Smart Import wizard.
// Groups mirror the client detail tabs (Client Info / Contacts /
// Registrations / Credentials) so the mapping dropdown is familiar.
// =============================================================

export interface ImportField {
  /** Canonical key. Plain client columns use the column name; address fields
   *  use `addr_<type>_<part>`; credential fields use `cred_<part>`; director
   *  fields use `director_<part>`. */
  key: string;
  /** Human label shown in the mapping dropdown and the import template. */
  label: string;
  /** Group heading for the dropdown. */
  group: string;
  /** True if at least one such field must be mapped before import. */
  required?: boolean;
  /** Lowercased alias strings (English + Greek) used for auto-matching. */
  aliases: string[];
}

// The full set of fields a spreadsheet column can be mapped onto.
export const IMPORT_FIELDS: ImportField[] = [
  // ---- Client Info ----
  { key: 'name', label: 'Name (primary)', group: 'Client Info', required: true,
    aliases: ['name', 'client name', 'company name', 'legal name', 'επωνυμία', 'όνομα εταιρείας', 'ονομασία'] },
  { key: 'name_tax_office', label: 'Name (Greek / tax office)', group: 'Client Info',
    aliases: ['greek name', 'tax office name', 'name as per tax office', 'name as per tax office return', 'ελληνική ονομασία', 'όνομα φορολογικού'] },
  { key: 'client_code', label: 'Client Code', group: 'Client Info',
    aliases: ['code', 'client code', 'client no', 'client number', 'κωδικός', 'κωδικός πελάτη'] },
  { key: 'trading_name', label: 'Trading Name', group: 'Client Info',
    aliases: ['trading name', 'dba', 'διακριτικός τίτλος'] },
  { key: 'client_category', label: 'Client Category', group: 'Client Info',
    aliases: ['category', 'client category', 'client type'] },
  { key: 'client_status', label: 'Client Status', group: 'Client Info',
    aliases: ['status', 'client status'] },
  { key: 'business_type', label: 'Business Type', group: 'Client Info',
    aliases: ['business type'] },
  { key: 'industry_sector', label: 'Industry / Sector', group: 'Client Info',
    aliases: ['industry', 'sector', 'industry sector'] },
  { key: 'bank_iban', label: 'Bank IBAN', group: 'Client Info',
    aliases: ['iban', 'bank iban', 'bank account', 'αριθμός λογαριασμού'] },
  { key: 'services', label: 'Services', group: 'Client Info',
    aliases: ['services', 'υπηρεσίες'] },
  { key: 'monthly_fee', label: 'Monthly Fee', group: 'Client Info',
    aliases: ['monthly fee'] },
  { key: 'annual_fee_agreed', label: 'Annual Fee Agreed', group: 'Client Info',
    aliases: ['annual fee', 'annual fee agreed', 'fee agreed'] },
  { key: 'engagement_letter_date', label: 'Engagement Letter Date', group: 'Client Info',
    aliases: ['engagement letter date', 'engagement date'] },
  { key: 'auditor_name', label: 'Auditor Name', group: 'Client Info',
    aliases: ['auditor', 'auditor name', 'ελεγκτής'] },
  { key: 'notes', label: 'Notes', group: 'Client Info',
    aliases: ['notes', 'comments', 'remarks', 'σημειώσεις'] },

  // ---- Contacts ----
  { key: 'phone', label: 'Phone', group: 'Contacts',
    aliases: ['phone', 'tel', 'telephone', 'phone number', 'τηλέφωνο'] },
  { key: 'mobile', label: 'Mobile', group: 'Contacts',
    aliases: ['mobile', 'cell', 'mobile number', 'κινητό'] },
  { key: 'email', label: 'Email', group: 'Contacts',
    aliases: ['email', 'e mail', 'email address', 'ηλεκτρονικό ταχυδρομείο'] },
  { key: 'website', label: 'Website', group: 'Contacts',
    aliases: ['website', 'web', 'url', 'ιστοσελίδα'] },
  { key: 'fax', label: 'Fax', group: 'Contacts',
    aliases: ['fax'] },
  { key: 'contact_person', label: 'Contact Person', group: 'Contacts',
    aliases: ['contact person', 'contact', 'αρμόδιος', 'υπεύθυνος'] },

  // ---- Registered Address ----
  { key: 'addr_registered_line1', label: 'Registered — Line 1', group: 'Registered Address',
    aliases: ['address', 'address line 1', 'registered address', 'registered office', 'street', 'διεύθυνση'] },
  { key: 'addr_registered_line2', label: 'Registered — Line 2', group: 'Registered Address',
    aliases: ['address line 2'] },
  { key: 'addr_registered_city', label: 'Registered — City', group: 'Registered Address',
    aliases: ['city', 'town', 'πόλη'] },
  { key: 'addr_registered_postal', label: 'Registered — Postal Code', group: 'Registered Address',
    aliases: ['postal code', 'post code', 'postcode', 'zip', 'τκ', 'ταχυδρομικός κώδικας'] },
  { key: 'addr_registered_country', label: 'Registered — Country', group: 'Registered Address',
    aliases: ['country', 'χώρα'] },

  // ---- Trading Address ----
  { key: 'addr_trading_line1', label: 'Trading — Line 1', group: 'Trading Address',
    aliases: ['trading address', 'trading address line 1', 'physical address'] },
  { key: 'addr_trading_line2', label: 'Trading — Line 2', group: 'Trading Address',
    aliases: ['trading address line 2'] },
  { key: 'addr_trading_city', label: 'Trading — City', group: 'Trading Address',
    aliases: ['trading city'] },
  { key: 'addr_trading_postal', label: 'Trading — Postal Code', group: 'Trading Address',
    aliases: ['trading postal code', 'trading post code'] },
  { key: 'addr_trading_country', label: 'Trading — Country', group: 'Trading Address',
    aliases: ['trading country'] },

  // ---- Postal Address ----
  { key: 'addr_postal_line1', label: 'Postal — Line 1', group: 'Postal Address',
    aliases: ['postal address', 'postal address line 1', 'mailing address'] },
  { key: 'addr_postal_line2', label: 'Postal — Line 2', group: 'Postal Address',
    aliases: ['postal address line 2'] },
  { key: 'addr_postal_city', label: 'Postal — City', group: 'Postal Address',
    aliases: ['postal city', 'mailing city'] },
  { key: 'addr_postal_postal', label: 'Postal — Postal Code', group: 'Postal Address',
    aliases: ['postal address postal code'] },
  { key: 'addr_postal_country', label: 'Postal — Country', group: 'Postal Address',
    aliases: ['postal country', 'mailing country'] },

  // ---- Registrations ----
  { key: 'tax_number', label: 'Tax Number (TIC)', group: 'Registrations',
    aliases: ['tic', 'tax number', 'tax id', 'tax identification code', 'αφμ', 'ταυτότητα φορολογουμένου'] },
  { key: 'vat_number', label: 'VAT Number', group: 'Registrations',
    aliases: ['vat', 'vat no', 'vat number', 'vat reg', 'vat registration', 'αρ φπα', 'αριθμός φπα'] },
  { key: 'vat_status', label: 'VAT Status', group: 'Registrations',
    aliases: ['vat status'] },
  { key: 'vat_period', label: 'VAT Period (legacy free text)', group: 'Registrations',
    aliases: ['vat period'] },
  { key: 'vat_category', label: 'VAT Category (A-G)', group: 'Registrations',
    aliases: ['vat category', 'vat cat', 'κατηγορία φπα'] },
  { key: 'oss_vat_category', label: 'OSS VAT Category (A-G)', group: 'Registrations',
    aliases: ['oss vat category', 'oss category', 'oss vat', 'oss', 'κατηγορία oss'] },
  { key: 'vat_registration_date', label: 'VAT Registration Date', group: 'Registrations',
    aliases: ['vat registration date', 'vat reg date'] },
  { key: 'registration_number', label: 'HE / Registration Number', group: 'Registrations',
    aliases: ['he', 'he number', 'he no', 'registration number', 'company registration', 'αρ μητρώου', 'αριθμός εγγραφής'] },
  { key: 'incorporation_date', label: 'Incorporation Date', group: 'Registrations',
    aliases: ['incorporation date', 'date of incorporation', 'ημερομηνία σύστασης'] },
  { key: 'year_of_incorporation', label: 'Year of Incorporation', group: 'Registrations',
    aliases: ['year of incorporation', 'incorporation year'] },
  { key: 'year_end_date', label: 'Year End', group: 'Registrations',
    aliases: ['year end', 'year end date', 'y e', 'ye', 'financial year end'] },
  { key: 'employer_number', label: 'SI Employer Number', group: 'Registrations',
    aliases: ['employer number', 'si number', 'si employer number', 'social insurance employer'] },
  { key: 'ergani_number', label: 'ERGANI Number', group: 'Registrations',
    aliases: ['ergani', 'ergani number'] },
  { key: 'social_insurance_number', label: 'Social Insurance Number', group: 'Registrations',
    aliases: ['social insurance number', 'si no', 'social insurance'] },
  { key: 'id_number', label: 'ID Number', group: 'Registrations',
    aliases: ['id number', 'identity number', 'id no', 'ταυτότητα'] },
  { key: 'passport_number', label: 'Passport Number', group: 'Registrations',
    aliases: ['passport', 'passport number', 'passport no', 'διαβατήριο'] },
  { key: 'date_of_birth', label: 'Date of Birth', group: 'Registrations',
    aliases: ['date of birth', 'dob', 'birth date', 'ημερομηνία γέννησης'] },
  { key: 'nationality', label: 'Nationality', group: 'Registrations',
    aliases: ['nationality', 'υπηκοότητα'] },

  // ---- Credentials (one platform login per row) ----
  { key: 'cred_platform', label: 'Credential — Platform', group: 'Credentials',
    aliases: ['platform', 'system', 'login system', 'credential platform', 'portal', 'taxisnet'] },
  { key: 'cred_username', label: 'Credential — Username', group: 'Credentials',
    aliases: ['username', 'user name', 'login username', 'login id', 'user id', 'login'] },
  { key: 'cred_password', label: 'Credential — Password', group: 'Credentials',
    aliases: ['password', 'login password', 'credential password', 'pin', 'κωδικός πρόσβασης'] },
  { key: 'cred_notes', label: 'Credential — Notes', group: 'Credentials',
    aliases: ['credential notes', 'login notes'] },

  // ---- Directors (when director rows share the sheet) ----
  { key: 'director_name', label: 'Director — Name', group: 'Directors',
    aliases: ['director', 'director name', 'officer name', 'διευθυντής'] },
  { key: 'director_role', label: 'Director — Role', group: 'Directors',
    aliases: ['director role', 'officer role'] },
  { key: 'director_id_number', label: 'Director — ID Number', group: 'Directors',
    aliases: ['director id', 'director id number'] },
  { key: 'director_nationality', label: 'Director — Nationality', group: 'Directors',
    aliases: ['director nationality'] },
  { key: 'director_shareholding', label: 'Director — Shareholding %', group: 'Directors',
    aliases: ['shareholding', 'shareholding percent', 'shareholding %', 'shares', 'ποσοστό'] },
  { key: 'director_appointed_date', label: 'Director — Appointed Date', group: 'Directors',
    aliases: ['appointed date', 'appointment date', 'director appointed'] },
];

const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]));
export const fieldLabel = (key: string): string => FIELD_BY_KEY.get(key)?.label || key;

// Distinct group names, in registry order — for grouping the mapping dropdown.
export const FIELD_GROUPS: string[] = IMPORT_FIELDS.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.group)) acc.push(f.group);
  return acc;
}, []);

/** Lowercase, fold punctuation/separators to spaces, keep letters (incl. Greek) + digits. */
export function normaliseHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[._/\\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AutoMatch {
  fieldKey: string | null;
  /** 0-100. >= 70 is a confident match; below that, flag for user attention. */
  confidence: number;
}

/** Best-guess field for a spreadsheet header. Matches against each field's
 *  aliases, its label and its key — so the exported template (headers = labels)
 *  re-imports at 100% confidence. */
export function autoMatch(header: string): AutoMatch {
  const n = normaliseHeader(header);
  if (!n) return { fieldKey: null, confidence: 0 };
  let best: AutoMatch = { fieldKey: null, confidence: 0 };
  for (const f of IMPORT_FIELDS) {
    for (const candidate of [f.label, f.key, ...f.aliases]) {
      const a = normaliseHeader(candidate);
      let score = 0;
      if (n === a) score = 100;
      else if (n.replace(/\s/g, '') === a.replace(/\s/g, '')) score = 95;
      else if (a.length >= 3 && (n.includes(a) || a.includes(n))) {
        const ratio = Math.min(n.length, a.length) / Math.max(n.length, a.length);
        score = Math.round(58 + 30 * ratio);
      }
      if (score > best.confidence) best = { fieldKey: f.key, confidence: score };
    }
  }
  return best;
}

export const CONFIDENT_THRESHOLD = 70;
