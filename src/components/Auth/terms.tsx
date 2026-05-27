// Current Terms version. Bump this whenever the wording materially changes
// (e.g. when final legal text replaces the placeholder below) — every user
// will be re-prompted to accept on their next visit.
export const CURRENT_TOS_VERSION = 1;

// Placeholder Terms of Service / Acceptable Use. DRAFT — pending legal review.
// Replace the body with the firm's lawyer-approved wording, then bump
// CURRENT_TOS_VERSION so everyone re-accepts.
export function TermsContent() {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6, color: '#334155' }}>
      <p style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '8px 12px', color: '#92400e' }}>
        <strong>DRAFT — pending legal review.</strong> This is placeholder wording. The firm's
        final Terms of Service will replace it before public launch.
      </p>

      <h4>1. The service</h4>
      <p>
        PC Prime &amp; Calculate ("the Firm") provides this online portal for accounting,
        bookkeeping, invoicing, document handling and related communication. Access is provided
        to engaged clients and authorised staff.
      </p>

      <h4>2. Acceptable use</h4>
      <p>
        You agree to use the portal only for its intended purpose, to keep your login and any
        two-factor device secure, and not to upload unlawful content or attempt to access data
        that is not yours. You are responsible for activity under your account.
      </p>

      <h4>3. Your data &amp; AI-assisted processing</h4>
      <p>
        Documents you upload may be processed with automated and AI-assisted tools to extract
        information; extracted data may contain errors and is reviewed by the Firm. How we handle
        and store your data is described in our{' '}
        <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a>.
      </p>

      <h4>4. Accuracy &amp; responsibility</h4>
      <p>
        Figures shown in the portal (including indicative reports and VAT estimates) are for
        convenience; official filings and advice are confirmed by the Firm. The portal is provided
        on an "as is" basis without warranty of uninterrupted availability.
      </p>

      <h4>5. Changes</h4>
      <p>
        The Firm may update these Terms. When they change materially, you will be asked to accept
        the new version before continuing to use the portal.
      </p>
    </div>
  );
}
