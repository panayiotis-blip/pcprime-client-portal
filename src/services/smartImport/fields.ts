// =============================================================
// Smart Import — importable client field registry + auto-matcher.
// Shared by every phase of the Smart Import wizard.
// =============================================================

export interface ImportField {
  /** Canonical key. Plain client columns use the column name; address fields
   *  use `addr_<type>_<part>`; director fields use `director_<part>`. */
  key: string;
  /** Human label shown in the mapping dropdown. */
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
  // ---- Identity ----
  { key: 'name', label: 'Name (primary)', group: 'Identity', required: true,
    aliases: ['name', 'client name', 'company name', 'legal name', 'επωνυμία', 'όνομα εταιρείας', 'ονομασία'] },
  { key: 'name_tax_office', label: 'Name (Greek / tax office)', group: 'Identity',
    aliases: ['greek name', 'tax office name', 'name as per tax office', 'name as per tax office return', 'ελληνική ονομασία', 'όνομα φορολογικού'] },
  { key: 'client_code', label: 'Client Code', group: 'Identity',
    aliases: ['code', 'client code', 'client no', 'client number', 'κωδικός', 'κωδικός πελάτη'] },
  { key: 'trading_name', label: 'Trading Name', group: 'Identity',
    aliases: ['trading name', 'dba', 'διακριτικός τίτλος'] },

  // ---- Classification ----
  { key: 'client_category', label: 'Client Category', group: 'Classification',
    aliases: ['category', 'client category', 'client type'] },
  { key: 'client_status', label: 'Client Status', group: 'Classification',
    aliases: ['status', 'client status'] },
  { key: 'business_type', label: 'Business Type', group: 'Classification',
    aliases: ['business type'] },
  { key: 'industry_sector', label: 'Industry / Sector', group: 'Classification',
    aliases: ['industry', 'sector', 'industry sector'] },

  // ---- Tax & Registration ----
  { key: 'tax_number', label: 'Tax Number (TIC)', group: 'Tax & Registration',
    aliases: ['tic', 'tax number', 'tax id', 'tax identification code', 'αφμ', 'ταυτότητα φορολογουμένου'] },
  { key: 'vat_number', label: 'VAT Number', group: 'Tax & Registration',
    aliases: ['vat', 'vat no', 'vat number', 'vat reg', 'vat registration', 'αρ φπα', 'αριθμός φπα'] },
  { key: 'vat_status', label: 'VAT Status', group: 'Tax & Registration',
    aliases: ['vat status'] },
  { key: 'vat_period', label: 'VAT Period', group: 'Tax & Registration',
    aliases: ['vat period'] },
  { key: 'vat_registration_date', label: 'VAT Registration Date', group: 'Tax & Registration',
    aliases: ['vat registration date', 'vat reg date'] },
  { key: 'registration_number', label: 'HE / Registration Number', group: 'Tax & Registration',
    aliases: ['he', 'he number', 'he no', 'registration number', 'company registration', 'αρ μητρώου', 'αριθμός εγγραφής'] },
  { key: 'incorporation_date', label: 'Incorporation Date', group: 'Tax & Registration',
    aliases: ['incorporation date', 'date of incorporation', 'ημερομηνία σύστασης'] },
  { key: 'year_of_incorporation', label: 'Year of Incorporation', group: 'Tax & Registration',
    aliases: ['year of incorporation', 'incorporation year'] },
  { key: 'year_end_date', label: 'Year End', group: 'Tax & Registration',
    aliases: ['year end', 'year end date', 'y e', 'ye', 'financial year end'] },
  { key: 'employer_number', label: 'SI Employer Number', group: 'Tax & Registration',
    aliases: ['employer number', 'si number', 'si employer number', 'social insurance employer'] },
  { key: 'ergani_number', label: 'ERGANI Number', group: 'Tax & Registration',
    aliases: ['ergani', 'ergani number'] },
  { key: 'social_insurance_number', label: 'Social Insurance Number', group: 'Tax & Registration',
    aliases: ['social insurance number', 'si no', 'social insurance'] },

  // ---- Personal (individuals) ----
  { key: 'id_number', label: 'ID Number', group: 'Personal',
    aliases: ['id number', 'identity number', 'id no', 'ταυτότητα'] },
  { key: 'passport_number', label: 'Passport Number', group: 'Personal',
    aliases: ['passport', 'passport number', 'passport no', 'διαβατήριο'] },
  { key: 'date_of_birth', label: 'Date of Birth', group: 'Personal',
    aliases: ['date of birth', 'dob', 'birth date', 'ημερομηνία γέννησης'] },
  { key: 'nationality', label: 'Nationality', group: 'Personal',
    aliases: ['nationality', 'υπηκοότητα'] },

  // ---- Contact ----
  { key: 'phone', label: 'Phone', group: 'Contact',
    aliases: ['phone', 'tel', 'telephone', 'phone number', 'τηλέφωνο'] },
  { key: 'mobile', label: 'Mobile', group: 'Contact',
    aliases: ['mobile', 'cell', 'mobile number', 'κινητό'] },
  { key: 'email', label: 'Email', group: 'Contact',
    aliases: ['email', 'e mail', 'email address', 'ηλεκτρονικό ταχυδρομείο'] },
  { key: 'website', label: 'Website', group: 'Contact',
    aliases: ['website', 'web', 'url', 'ιστοσελίδα'] },
  { key: 'fax', label: 'Fax', group: 'Contact',
    aliases: ['fax'] },
  { key: 'contact_person', label: 'Contact Person', group: 'Contact',
    aliases: ['contact person', 'contact', 'αρμόδιος', 'υπεύθυνος'] },

  // ---- Banking ----
  { key: 'bank_iban', label: 'Bank IBAN', group: 'Banking',
    aliases: ['iban', 'bank iban', 'bank account', 'αριθμός λογαριασμού'] },

  // ---- Engagement ----
  { key: 'engagement_letter_date', label: 'Engagement Letter Date', group: 'Engagement',
    aliases: ['engagement letter date', 'engagement date'] },
  { key: 'annual_fee_agreed', label: 'Annual Fee Agreed', group: 'Engagement',
    aliases: ['annual fee', 'annual fee agreed', 'fee agreed'] },
  { key: 'monthly_fee', label: 'Monthly Fee', group: 'Engagement',
    aliases: ['monthly fee'] },
  { key: 'auditor_name', label: 'Auditor Name', group: 'Engagement',
    aliases: ['auditor', 'auditor name', 'ελεγκτής'] },
  { key: 'services', label: 'Services', group: 'Engagement',
    aliases: ['services', 'υπηρεσίες'] },
  { key: 'notes', label: 'Notes', group: 'Engagement',
    aliases: ['notes', 'comments', 'remarks', 'σημειώσεις'] },

  // ---- Registered Address (generic address aliases land here) ----
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

  // ---- Director (when director rows share the sheet) ----
  { key: 'director_name', label: 'Director — Name', group: 'Director',
    aliases: ['director', 'director name', 'officer name', 'διευθυντής'] },
  { key: 'director_role', label: 'Director — Role', group: 'Director',
    aliases: ['director role', 'role', 'officer role'] },
  { key: 'director_id_number', label: 'Director — ID Number', group: 'Director',
    aliases: ['director id', 'director id number'] },
  { key: 'director_nationality', label: 'Director — Nationality', group: 'Director',
    aliases: ['director nationality'] },
  { key: 'director_shareholding', label: 'Director — Shareholding %', group: 'Director',
    aliases: ['shareholding', 'shareholding percent', 'shareholding %', 'shares', 'ποσοστό'] },
  { key: 'director_appointed_date', label: 'Director — Appointed Date', group: 'Director',
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

/** Best-guess field for a spreadsheet header. */
export function autoMatch(header: string): AutoMatch {
  const n = normaliseHeader(header);
  if (!n) return { fieldKey: null, confidence: 0 };
  let best: AutoMatch = { fieldKey: null, confidence: 0 };
  for (const f of IMPORT_FIELDS) {
    for (const alias of f.aliases) {
      const a = normaliseHeader(alias);
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
