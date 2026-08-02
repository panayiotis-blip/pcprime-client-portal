// Other systems the firm runs that are NOT part of this portal.
//
// They have their own hosting, their own database and their own logins —
// nothing is shared with the portal, and the portal knows nothing about what
// happens inside them. All the portal offers is a way through, so people don't
// have to keep the addresses in their heads.
//
// Anything listed here is FIRM-ONLY: these links appear in staff navigation and
// on the staff apps launcher, never in a client's portal.

export type ExternalSystem = {
  key: string;
  label: string;
  icon: string;
  url: string;
  description: string;
};

export const EXTERNAL_SYSTEMS: ExternalSystem[] = [
  {
    key: 'property-erp',
    label: 'Property ERP',
    icon: '🏢',
    url: 'https://erp.primeandcalculate.com',
    description: 'Separate system — opens in a new tab and asks for its own login.',
  },
];

export const ERP_URL = EXTERNAL_SYSTEMS[0].url;
