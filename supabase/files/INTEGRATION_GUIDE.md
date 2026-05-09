# Cyprus Tax Calculator — Integration Guide

## File: `CyprusTaxCalculator.jsx`

A complete React component for Cyprus personal tax computation supporting tax years 2025 and 2026, with PDF/CSV export and email integration.

---

## Quick Integration into Your Client Portal

### 1. Save the File

Place `CyprusTaxCalculator.jsx` into your project's components folder:

```
your-portal/
├── src/
│   ├── components/
│   │   └── CyprusTaxCalculator.jsx   ← here
│   └── App.jsx
```

### 2. Install Required Dependencies

If not already installed in your portal project:

```bash
npm install lucide-react
```

That's the only npm dependency. **jsPDF loads from CDN dynamically** when the user clicks "Download PDF" — no install needed.

### 3. Import and Use

In any page or component where you want the calculator:

```jsx
import CyprusTaxCalculator from './components/CyprusTaxCalculator';

function TaxCalculatorPage() {
  return <CyprusTaxCalculator />;
}

export default TaxCalculatorPage;
```

That's it — fully self-contained.

---

## Features Included

### Calculation Engine
- **Tax Years 2025 & 2026** with year-agnostic engine (easily extensible to future years)
- **Side-by-side comparison mode** — see 2025 vs 2026 impact for each client
- ✓ Verified against Cyprus MOF official calculator (taxtools.mof.gov.cy)

### Comprehensive Field Coverage
- **Personal Profile** — Tax residency (183/60-day), first employment, disability flags
- **Income** — Employment, self-employed, rental, foreign pension, Cyprus pension (incl. widow's pension 5% election), qualifying IP royalties (80% IP Box exemption), ordinary royalties, court order income, trading goodwill, crypto mining
- **Capital Gains** — Display-only section for shares (0%) and Cyprus property (separate CGT)
- **Special-Rate & Defence** — Non-dom toggle, dividends, interest, crypto disposal, foreign employee reliefs (50%/20%), 90-day rule with auto pro-rata calculation
- **Deductions** — SI/GHS, pension/medical/life (capped), donations, professional subscriptions, capital allowances, bad debts, rental maintenance, disability expenses, foreign tax credit, losses c/f
- **2026 New Allowances** — Children, students, mortgage/rent, green spend, home insurance (with family income threshold check)

### Export Options
- **PDF Download** — Branded with your logo, professional layout, smart pagination
- **CSV Export** — Full breakdown for Excel record-keeping
- **Email to Client** — Pre-filled professional email via mailto:
- **Print-Friendly View** — Light-themed printable layout

### UI
- Multi-year toggle (2025 / 2026)
- Comparison mode showing delta and tax savings
- Expandable input sections
- Real-time computation panel
- Brand colors: Navy `#1a365d`, Gold `#9b861f`

---

## Customization Points

### Update Brand Details

If you want to change the firm details that appear in PDF/Email outputs, search for these strings in the file:

```
'PC Prime & Calculate Consultants Ltd'
'Panayiotis Savvas'
'Professional Accountant (SA)'
'+357 96 332 274'
'panayiotis@primeandcalculate.com'
```

### Replace the Logo

The logo is embedded as a base64 data URI in the `FIRM_LOGO` constant near the top of the file (search for `const FIRM_LOGO`). To replace it:

1. Convert your new logo PNG/SVG to base64 (https://www.base64-image.de/)
2. Replace the entire `FIRM_LOGO` string with your new data URI

### Add New Tax Years

When 2027 rates are released:

1. Find the `TAX_YEARS` constant near the top
2. Add a new year object following the same structure as `2026`
3. Update the year selector buttons (search for `[2025, 2026].map`) to include the new year

---

## Key Technical Notes

### React Version Compatibility
- Built for **React 18+**
- Uses hooks: `useState`, `useMemo`, `useCallback`
- All components defined outside the main function for stable references (prevents input focus loss)

### Browser Compatibility
- Modern browsers (Chrome, Edge, Firefox, Safari)
- `mailto:` links require a configured email client
- PDF download works on all modern browsers

### No External API Calls
- All calculations happen client-side
- Logo embedded inline (no external image hosting needed)
- jsPDF library loaded from cdnjs.cloudflare.com on first PDF export

### Data Privacy
- Calculator runs entirely in the browser — no data sent to any server
- Suitable for portal use where client confidentiality is paramount

---

## Supabase Integration (Future)

To save calculations to your Supabase backend:

```jsx
// At the top of CyprusTaxCalculator.jsx, add:
import { supabase } from './supabaseClient';

// Inside the component, add a save handler:
const saveCalculation = async () => {
  const { data, error } = await supabase
    .from('tax_calculations')
    .insert([{
      client_id: clientId,  // pass as prop
      tax_year: selectedYear,
      input_data: { /* all input states */ },
      results: activeResults,
      created_at: new Date(),
    }]);
};

// Add a Save button next to Export PDF
```

Database schema suggestion:

```sql
CREATE TABLE tax_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),
  tax_year integer NOT NULL,
  input_data jsonb NOT NULL,
  results jsonb NOT NULL,
  reference_number text,
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

---

## Troubleshooting

### "Cannot read property of undefined" errors
Make sure `lucide-react` is installed (`npm install lucide-react`)

### PDF download doesn't work
- Check browser pop-up blocker isn't preventing the download
- Ensure internet connection (jsPDF loads from CDN on first use)
- Try the "Print Preview (Fallback)" option instead

### Logo not showing in PDF
The logo is embedded as a base64 data URI — should always work. If it fails, the PDF will fall back to a text-based logo automatically.

### Calculation discrepancies
The calculator has been verified against the Cyprus MOF official calculator. If you spot a discrepancy, check:
- Tax year selected (2025 vs 2026 have different rates)
- Non-dom status (affects SDC)
- Family income threshold for 2026 allowances

---

## Verification Status

✓ Syntax validated with Babel parser
✓ 2025 calculations match Cyprus MOF calculator
✓ 2026 calculations based on Law 17.2026 (passed 22 December 2025)
✓ All 7 input sections operational
✓ All 4 export options functional

---

## Version

**Stage 1 Complete** — Tax Calculator with comprehensive field coverage and export options.

**Next stages (when ready):**
- Stage 2: Full structured tax return form (TD1-style with multiple income sources)
- Stage 3: Client profile & state persistence
- Stage 4: Supabase portal integration
- Stage 5: Admin dashboard
- Stage 6: Greek language support

---

*Prepared for PC Prime & Calculate Consultants Ltd*
