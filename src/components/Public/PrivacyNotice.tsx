import { Link } from 'react-router-dom';

const LAST_UPDATED = '11 May 2026';

export default function PrivacyNotice() {
  return (
    <div style={{
      maxWidth: 820, margin: '0 auto', padding: '32px 24px 64px',
      lineHeight: 1.6, color: '#0f172a',
    }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/" style={{ color: '#3730a3', textDecoration: 'none', fontSize: 14 }}>← Back to home</Link>
      </div>

      <h1 style={{ marginBottom: 4 }}>Privacy Notice</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 32 }}>
        Last updated: {LAST_UPDATED}
      </p>

      <section style={{ marginBottom: 28 }}>
        <h2>1. Who we are</h2>
        <p>
          This privacy notice describes how <strong>PC Prime &amp; Calculate Consultants Ltd</strong>{' '}
          ("we", "us", "our") collects, uses and protects your personal data when you use our
          accounting, tax and consultancy services and our client portal.
        </p>
        <p>
          We are the <strong>data controller</strong> for the personal data described in this notice.
        </p>
        <p style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <strong>PC Prime &amp; Calculate Consultants Ltd</strong><br />
          Dikomou 12, Office 201, Kiti, 7550 Larnaca, Cyprus<br />
          Email: <a href="mailto:info@primeandcalculate.com">info@primeandcalculate.com</a><br />
          Phone: <a href="tel:+35724258346">+357 24 258346</a>
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>2. What personal data we collect</h2>
        <p>To provide our services we collect and process the following categories of personal data:</p>
        <ul>
          <li><strong>Identification data</strong> — full name, ID or passport number, date of birth, nationality.</li>
          <li><strong>Contact data</strong> — postal address, email address, phone number.</li>
          <li><strong>Tax and financial data</strong> — VAT number, tax registration number, social insurance number, bank details, income and expenses, invoices, receipts.</li>
          <li><strong>Documents you upload</strong> — invoices, contracts, KYC documents, copies of identification, correspondence and any other documents you submit through the client portal.</li>
          <li><strong>Communication records</strong> — emails, phone-call logs and messages exchanged with our staff.</li>
          <li><strong>Portal usage data</strong> — login times, IP address, browser type and an audit log of actions performed in the portal.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>3. Why we process your data (purposes and lawful bases)</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Purpose</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Lawful basis (GDPR Art. 6)</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '8px 6px' }}>Provide accounting, tax and consultancy services under our engagement letter</td>
              <td style={{ padding: '8px 6px' }}>Performance of a contract (Art. 6(1)(b))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '8px 6px' }}>Comply with statutory record-keeping (Cyprus tax law, Companies Law, VAT Law)</td>
              <td style={{ padding: '8px 6px' }}>Legal obligation (Art. 6(1)(c))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '8px 6px' }}>Verify identity and prevent money laundering (KYC, AML)</td>
              <td style={{ padding: '8px 6px' }}>Legal obligation (Art. 6(1)(c))</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '8px 6px' }}>Secure the portal, prevent fraud, keep audit logs</td>
              <td style={{ padding: '8px 6px' }}>Legitimate interests (Art. 6(1)(f))</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 6px' }}>Send service-related communications (deadline reminders, document requests)</td>
              <td style={{ padding: '8px 6px' }}>Performance of a contract (Art. 6(1)(b))</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>4. Who we share your data with</h2>
        <p>We only share personal data where we have to. The recipients are:</p>
        <ul>
          <li><strong>Tax and government authorities</strong> — Cyprus Tax Department, Social Insurance Services, Registrar of Companies and similar bodies, when filing on your behalf or where required by law.</li>
          <li><strong>Our service providers (processors)</strong> who act on our written instructions:
            <ul>
              <li><strong>Supabase Inc.</strong> — hosted database and file storage. EU project region (Frankfurt).</li>
              <li><strong>Vercel Inc.</strong> — web application hosting. EU edge region (Frankfurt) with global CDN.</li>
            </ul>
          </li>
          <li><strong>Professional advisers</strong> — lawyers, auditors or other regulated professionals where strictly necessary, under a duty of confidentiality.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal data and we do <strong>not</strong> share it
          for advertising purposes.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>5. International transfers</h2>
        <p>
          Your data is hosted in the European Union. Where any processor (e.g. CDN edge nodes) may
          transit data outside the EU, the transfer is protected by the European Commission's
          Standard Contractual Clauses or another approved transfer mechanism.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>6. How long we keep your data</h2>
        <ul>
          <li><strong>Accounting records and supporting documents</strong> — at least 6 years from the end of the tax year, as required by Cyprus tax law.</li>
          <li><strong>KYC and AML records</strong> — 5 years from the end of the client relationship.</li>
          <li><strong>Audit logs of portal activity</strong> — 2 years from the date of the action.</li>
          <li><strong>Other personal data</strong> — for as long as you are a client, plus the statutory retention period above.</li>
        </ul>
        <p>After these periods we securely delete or anonymise the data.</p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>7. How we protect your data</h2>
        <ul>
          <li>Encryption in transit (HTTPS/TLS) for all portal traffic.</li>
          <li>Encryption at rest for the database and file storage.</li>
          <li>Role-based access control inside the portal; staff only see what they need.</li>
          <li>Multi-factor authentication for staff accounts handling sensitive data.</li>
          <li>Detailed audit logs of access to sensitive information.</li>
          <li>Regular review of users, permissions and security configuration.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>8. Your rights</h2>
        <p>Under the EU General Data Protection Regulation (GDPR) you have the right to:</p>
        <ul>
          <li><strong>Access</strong> the personal data we hold about you.</li>
          <li><strong>Rectify</strong> inaccurate or incomplete data.</li>
          <li><strong>Erase</strong> your data, where statutory retention obligations do not apply.</li>
          <li><strong>Restrict</strong> or <strong>object</strong> to certain processing.</li>
          <li><strong>Receive</strong> your data in a portable, machine-readable format.</li>
          <li><strong>Withdraw consent</strong> at any time where processing is based on consent.</li>
          <li><strong>Lodge a complaint</strong> with the Cyprus supervisory authority (see below).</li>
        </ul>
        <p>
          To exercise any of these rights, email{' '}
          <a href="mailto:info@primeandcalculate.com">info@primeandcalculate.com</a>. We will
          respond within one month, as required by GDPR.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>9. Supervisory authority</h2>
        <p>
          If you believe we have not handled your personal data properly, you can complain to
          the Cyprus supervisory authority:
        </p>
        <p style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <strong>Office of the Commissioner for Personal Data Protection</strong><br />
          1 Iasonos Street, 1082 Nicosia, Cyprus<br />
          Phone: +357 22 818 456<br />
          Email: <a href="mailto:commissioner@dataprotection.gov.cy">commissioner@dataprotection.gov.cy</a><br />
          Web: <a href="https://www.dataprotection.gov.cy" target="_blank" rel="noopener noreferrer">www.dataprotection.gov.cy</a>
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>10. Changes to this notice</h2>
        <p>
          We may update this notice from time to time. The current version is always available
          at <Link to="/privacy">/privacy</Link>. The date at the top of the page shows when it
          was last revised. Material changes will be communicated to active clients by email.
        </p>
      </section>
    </div>
  );
}
