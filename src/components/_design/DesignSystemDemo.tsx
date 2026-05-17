import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { FolderOpen, Plus, Search, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  FormField,
  Input,
  Modal,
  RecordCounter,
  Select,
  Toolbar,
  type Column,
} from '../ui';

/* -------------------------------------------------------------------------
   Design System v2 — verification page (Part 1a).
   Renders every shared component in isolation so Pete can sign off the
   foundation before any real page is migrated (Parts 1b / 1c).
   Reachable at /design-system. Not linked in the sidebar — internal only.
   ------------------------------------------------------------------------- */

// Greek must render correctly in every component (task requirement).
const GREEK = 'ΑΧΙΛΛΕΥΣ & ΑΙΜΙΛΙΟΣ ΚΩΝΣΤΑΝΤΙΝΟΣ ΑΙΜΙΛΙΑΝΙΔΗΣ Δ.Ε.Π.Ε.';

interface DemoClient {
  id: number;
  code: string;
  name: string;
  category: string;
}

const DEMO_CLIENTS: DemoClient[] = [
  { id: 1, code: 'PC-CO-001', name: GREEK, category: 'Company' },
  { id: 2, code: 'PC-IN-132', name: 'Marina Bezuidenhout', category: 'Individual' },
  { id: 3, code: 'PC-CO-013', name: 'ΚΥΠΡΟΣ ΣΥΜΒΟΥΛΟΙ ΛΤΔ', category: 'Company' },
  { id: 4, code: 'PC-PA-007', name: 'Andreou & Partners', category: 'Partnership' },
  { id: 5, code: 'PC-IN-088', name: 'Γιώργος Παπαδόπουλος', category: 'Individual' },
  { id: 6, code: 'PC-CO-021', name: 'Mediterranean Holdings Ltd', category: 'Company' },
  { id: 7, code: 'PC-IN-150', name: 'Έλενα Χριστοδούλου', category: 'Individual' },
  { id: 8, code: 'PC-CO-034', name: 'Limassol Trading Co', category: 'Company' },
  { id: 9, code: 'PC-ST-004', name: 'Νίκος Ιωάννου (sole trader)', category: 'Sole trader' },
  { id: 10, code: 'PC-CO-040', name: 'Aphrodite Estates Ltd', category: 'Company' },
];

const COLOUR_TOKENS: Array<{ name: string; varName: string }> = [
  { name: 'Primary navy', varName: '--pc-navy' },
  { name: 'Secondary navy', varName: '--pc-navy-2' },
  { name: 'Gold accent', varName: '--pc-gold' },
  { name: 'Gold light', varName: '--pc-gold-light' },
  { name: 'Surface tint', varName: '--pc-tint' },
  { name: 'Border subtle', varName: '--pc-border' },
  { name: 'Text primary', varName: '--pc-text' },
  { name: 'Text secondary', varName: '--pc-text-2' },
  { name: 'Status green', varName: '--pc-green' },
  { name: 'Status amber', varName: '--pc-amber' },
  { name: 'Status red', varName: '--pc-red' },
  { name: 'Status blue', varName: '--pc-blue' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--pc-sp-48)' }}>
      <h2
        style={{
          fontSize: 'var(--pc-fs-18)',
          fontWeight: 'var(--pc-fw-semibold)',
          color: 'var(--pc-text)',
          margin: '0 0 var(--pc-sp-16)',
          paddingBottom: 'var(--pc-sp-8)',
          borderBottom: '1px solid var(--pc-border)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

const ROW: CSSProperties = {
  display: 'flex',
  gap: 'var(--pc-sp-12)',
  flexWrap: 'wrap',
  alignItems: 'center',
};

export default function DesignSystemDemo() {
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [activeChips, setActiveChips] = useState<Record<string, boolean>>({ company: true });
  const [demoText, setDemoText] = useState(GREEK);
  // Pre-select a row so the gold selected-row accent is visible on load.
  const [selectedRow, setSelectedRow] = useState<number | null>(2);

  const columns: Column<DemoClient>[] = [
    { key: 'code', header: 'Code', render: (r) => r.code, width: 140 },
    { key: 'name', header: 'Client name', render: (r) => r.name },
    { key: 'category', header: 'Category', render: (r) => r.category, width: 160 },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: () => (
        <Button variant="ghost" size="sm" iconOnly aria-label="Delete">
          <Trash2 size={15} />
        </Button>
      ),
    },
  ];

  const pagedRows = useMemo(
    () => DEMO_CLIENTS.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize],
  );

  const toggleChip = (id: string) =>
    setActiveChips((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div
      style={{
        fontFamily: 'var(--pc-font)',
        color: 'var(--pc-text)',
        background: 'var(--pc-tint)',
        padding: 'var(--pc-sp-24)',
        minHeight: '100%',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <Toolbar
          title="Design System v2 — Part 1a"
          actions={
            <>
              <Button variant="secondary" leftIcon={<Search size={16} />}>
                Secondary
              </Button>
              <Button variant="primary" leftIcon={<Plus size={16} />}>
                Primary action
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 'var(--pc-fs-14)', color: 'var(--pc-text-2)' }}>
            Foundation verification page. Every shared component below uses the{' '}
            <code>--pc-*</code> tokens and the Inter font. Greek test string:{' '}
            <strong>{GREEK}</strong>
          </p>
        </Toolbar>

        {/* ---- Colour tokens ---- */}
        <Section title="Colour tokens">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 'var(--pc-sp-12)',
            }}
          >
            {COLOUR_TOKENS.map((t) => (
              <div key={t.varName} style={{ display: 'flex', gap: 'var(--pc-sp-8)', alignItems: 'center' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--pc-radius-sm)',
                    background: `var(${t.varName})`,
                    border: '1px solid var(--pc-border)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--pc-fs-13)', fontWeight: 'var(--pc-fw-medium)' }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: 'var(--pc-fs-12)', color: 'var(--pc-text-3)' }}>
                    {t.varName}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---- Buttons ---- */}
        <Section title="Buttons">
          <div style={{ ...ROW, marginBottom: 'var(--pc-sp-16)' }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="primary" iconOnly aria-label="Add">
              <Plus size={16} />
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <div style={ROW}>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        {/* ---- Form controls ---- */}
        <Section title="Form controls">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--pc-sp-16)',
            }}
          >
            <FormField label="Client name" htmlFor="ds-name" required helper="As registered with the tax office.">
              <Input
                id="ds-name"
                value={demoText}
                onChange={(e) => setDemoText(e.target.value)}
                placeholder="Type a name…"
              />
            </FormField>
            <FormField label="VAT number" htmlFor="ds-vat" error="This VAT number is invalid.">
              <Input id="ds-vat" invalid defaultValue="CY-???" />
            </FormField>
            <FormField label="Client category" htmlFor="ds-cat">
              <Select
                id="ds-cat"
                options={[
                  { value: 'company', label: 'Company' },
                  { value: 'individual', label: 'Individual' },
                  { value: 'partnership', label: 'Partnership' },
                ]}
              />
            </FormField>
            <FormField label="Amount (€)" htmlFor="ds-amt">
              <Input id="ds-amt" type="number" placeholder="0.00" />
            </FormField>
            <FormField label="Notes" htmlFor="ds-notes" className="full-width">
              <Input id="ds-notes" multiline rows={3} defaultValue={`Σημείωση: ${GREEK}`} />
            </FormField>
          </div>
        </Section>

        {/* ---- Cards ---- */}
        <Section title="Cards">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--pc-sp-16)',
            }}
          >
            <Card title="Plain card">
              A white panel with a subtle border and the small elevation shadow.
            </Card>
            <Card
              title="Card with actions"
              actions={
                <Button size="sm" variant="secondary">
                  Edit
                </Button>
              }
            >
              The header bar holds a title and right-aligned actions.
            </Card>
            <Card title="Clickable card" clickable onClick={() => alert('Card clicked')}>
              Hover me — clickable cards lift slightly.
            </Card>
          </div>
        </Section>

        {/* ---- Modal ---- */}
        <Section title="Modal">
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Confirm action"
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>
                  Confirm
                </Button>
              </>
            }
          >
            <p style={{ marginTop: 0 }}>
              Modals are centred, scroll-locked, and close on Esc or backdrop click.
            </p>
            <p style={{ marginBottom: 0 }}>
              Greek renders correctly here too: <strong>{GREEK}</strong>
            </p>
          </Modal>
        </Section>

        {/* ---- Filter bar ---- */}
        <Section title="Filter bar">
          <FilterBar
            chips={[
              { id: 'company', label: 'Companies', active: activeChips.company, onToggle: () => toggleChip('company') },
              { id: 'individual', label: 'Individuals', active: activeChips.individual, onToggle: () => toggleChip('individual') },
              { id: 'vat', label: 'VAT registered', active: activeChips.vat, onToggle: () => toggleChip('vat') },
              {
                id: 'removable',
                label: 'Active only',
                active: true,
                onRemove: () => alert('Filter removed'),
              },
            ]}
          >
            <Button variant="ghost" size="sm" onClick={() => setActiveChips({})}>
              Clear all
            </Button>
          </FilterBar>
        </Section>

        {/* ---- DataTable ---- */}
        <Section title="DataTable (sticky header + pagination)">
          <p style={{ margin: '0 0 var(--pc-sp-12)', fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
            Click a row to select it — selected rows show a subtle gold tint and a gold left edge.
          </p>
          <DataTable
            columns={columns}
            rows={pagedRows}
            getRowId={(r) => r.id}
            selectedId={selectedRow}
            onRowClick={(r) => setSelectedRow(r.id)}
            pagination={{
              page,
              pageSize,
              total: DEMO_CLIENTS.length,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s);
                setPage(1);
              },
              pageSizeOptions: [5, 10, 25],
            }}
          />
        </Section>

        {/* ---- RecordCounter (standalone) ---- */}
        <Section title="RecordCounter (standalone)">
          <div style={{ border: '1px solid var(--pc-border)', borderRadius: 'var(--pc-radius-md)', background: 'var(--pc-white)' }}>
            <RecordCounter
              page={page}
              pageSize={pageSize}
              total={DEMO_CLIENTS.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              pageSizeOptions={[5, 10, 25]}
            />
          </div>
        </Section>

        {/* ---- Empty state ---- */}
        <Section title="Empty state">
          <Card flushBody>
            <EmptyState
              icon={<FolderOpen size={24} />}
              title="No documents yet"
              message="Scanned documents for this client will appear here once uploaded."
              action={
                <Button variant="primary" leftIcon={<Plus size={16} />}>
                  Scan a document
                </Button>
              }
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}
