import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { ScanProvider } from './context/ScanContext';
import { MFAStepUpProvider } from './context/MFAStepUpContext';
import { ViewPreferencesProvider } from './context/ViewPreferencesContext';
import { DashboardLayoutProvider } from './context/DashboardLayoutContext';
import { PanelSkeleton } from './components/ui';

/* Eager: the shell, the auth gates, and the two entry points. These are needed
   on the very first paint, so deferring them would only add a round trip. */
import AppShell from './components/Layout/AppShell';
import LoginPage from './components/Auth/LoginPage';
import LandingPage from './components/Public/LandingPage';
import MFAChallenge from './components/Auth/MFAChallenge';
import ForcedMfaSetup from './components/Auth/ForcedMfaSetup';
import ClientMfaNudge from './components/Auth/ClientMfaNudge';
import TermsGate from './components/Auth/TermsGate';
import { CURRENT_TOS_VERSION } from './components/Auth/terms';
import { isStaffRole } from './services/api';

/* Lazy: every route below is code-split into its own chunk, fetched on first
   visit. This keeps heavy, rarely-used dependencies (xlsx, jspdf, html2canvas,
   pdfjs, recharts) out of the initial download — they used to ship to every
   user on every cold load as part of one ~6.4 MB bundle. */
const Dashboard = lazy(() => import('./components/Dashboard'));
const ScannerPage = lazy(() => import('./components/Scanner/ScannerPage'));
const InvoiceEditor = lazy(() => import('./components/Invoice/InvoiceEditor'));
const ClientManager = lazy(() => import('./components/Client/ClientManager'));
const ClientDetail = lazy(() => import('./components/Client/ClientDetail'));
const ClientCardPrint = lazy(() => import('./components/Client/ClientCardPrint'));
const SmartImport = lazy(() => import('./components/Admin/SmartImport'));
const DuplicateFinder = lazy(() => import('./components/Admin/DuplicateFinder'));
const TaxFilingsPage = lazy(() => import('./components/Admin/TaxFilingsPage'));
const UnlinkedDirectors = lazy(() => import('./components/Admin/UnlinkedDirectors'));
const CredentialsVault = lazy(() => import('./components/Admin/CredentialsVault'));
const ExportPage = lazy(() => import('./components/Export/ExportPage'));
const DocumentsPage = lazy(() => import('./components/Documents/DocumentsPage'));
const UserManagement = lazy(() => import('./components/Admin/UserManagement'));
const ComplianceDashboard = lazy(() => import('./components/Admin/ComplianceDashboard'));
const AuditLog = lazy(() => import('./components/Admin/AuditLog'));
const StaffTasks = lazy(() => import('./components/Admin/StaffTasks'));
const TaskTemplates = lazy(() => import('./components/Admin/TaskTemplates'));
const Reports = lazy(() => import('./components/Admin/Reports'));
const Calendar = lazy(() => import('./components/Admin/Calendar'));
const Timesheet = lazy(() => import('./components/Admin/Timesheet'));
const TimesheetPrint = lazy(() => import('./components/Admin/TimesheetPrint'));
const CompanySettings = lazy(() => import('./components/Admin/CompanySettings'));
const MasterChartOfAccounts = lazy(() => import('./components/Admin/MasterChartOfAccounts'));
const ServiceSettings = lazy(() => import('./components/Admin/ServiceSettings'));
const EmailSettings = lazy(() => import('./components/Settings/EmailSettings'));
const InvoicesList = lazy(() => import('./components/Billing/InvoicesList'));
const BillingInvoiceEditor = lazy(() => import('./components/Billing/InvoiceEditor'));
const InvoicePrint = lazy(() => import('./components/Billing/InvoicePrint'));
const RecurringInvoices = lazy(() => import('./components/Billing/RecurringInvoices'));
const ReceiptPrint = lazy(() => import('./components/Billing/ReceiptPrint'));
const AgeAnalysis = lazy(() => import('./components/Billing/AgeAnalysis'));
const ClientStatement = lazy(() => import('./components/Billing/ClientStatement'));
const StatementPrint = lazy(() => import('./components/Billing/StatementPrint'));
const StatementsBatchPrint = lazy(() => import('./components/Billing/StatementsBatchPrint'));
const ServicePresets = lazy(() => import('./components/Billing/ServicePresets'));
const SalesReports = lazy(() => import('./components/Billing/SalesReports'));
const MyBilling = lazy(() => import('./components/Client/MyBilling'));
const MyDeadlines = lazy(() => import('./components/Client/MyDeadlines'));
const MyMessages = lazy(() => import('./components/Client/MyMessages'));
const MyEmails = lazy(() => import('./components/Client/MyEmails'));
const MessagesInbox = lazy(() => import('./components/Admin/MessagesInbox'));
const Inbox = lazy(() => import('./components/Admin/Inbox'));
const FirmEmailSettings = lazy(() => import('./components/Admin/FirmEmailSettings'));
const BulkEmail = lazy(() => import('./components/Admin/BulkEmail'));
const RequestTaxInfo = lazy(() => import('./components/Admin/RequestTaxInfo'));
const ClientIntakeReview = lazy(() => import('./components/Admin/ClientIntakeReview'));
const MyCompany = lazy(() => import('./components/Client/MyCompany'));
const MyCustomers = lazy(() => import('./components/Client/MyCustomers'));
const SalesInvoices = lazy(() => import('./components/Client/SalesInvoices'));
const CustomerInvoiceEditor = lazy(() => import('./components/Client/CustomerInvoiceEditor'));
const CustomerInvoicePrint = lazy(() => import('./components/Client/CustomerInvoicePrint'));
const CustomerReceiptPrint = lazy(() => import('./components/Client/CustomerReceiptPrint'));
const CustomerDebtors = lazy(() => import('./components/Client/CustomerDebtors'));
const MyExpenses = lazy(() => import('./components/Client/MyExpenses'));
const MyScanPage = lazy(() => import('./components/Client/MyScanPage'));
const ClientExpenses = lazy(() => import('./components/Admin/ClientExpenses'));
const MyReports = lazy(() => import('./components/Client/MyReports'));
const AiUsage = lazy(() => import('./components/Admin/AiUsage'));
const PhoneLog = lazy(() => import('./components/Admin/PhoneLog'));
const Security = lazy(() => import('./components/Admin/Security'));
const DeletedClients = lazy(() => import('./components/Admin/DeletedClients'));
const MergeClients = lazy(() => import('./components/Client/MergeClients'));
const TaxCalculator = lazy(() => import('./components/Public/TaxCalculator'));
const PrivacyNotice = lazy(() => import('./components/Public/PrivacyNotice'));
const SignupApplication = lazy(() => import('./components/Public/SignupApplication'));
const ResetPasswordPage = lazy(() => import('./components/Auth/ResetPasswordPage'));
const EngagementAcceptPage = lazy(() => import('./components/Public/EngagementAcceptPage'));
const ClientIntakePage = lazy(() => import('./components/Public/ClientIntakePage'));
const Applications = lazy(() => import('./components/Admin/Applications'));
const DesignSystemDemo = lazy(() => import('./components/_design/DesignSystemDemo'));

function AuthedApp() {
  const { user, mfa } = useAuth();

  // Hard gate: if the user has MFA enrolled but the session is at aal1,
  // block the entire app behind the 6-digit challenge — unless this device
  // has been marked as trusted (then the prompt is skipped).
  if (mfa.challenge_required && !mfa.trusted_device_validated) return <MFAChallenge />;

  // Hard gate: staff must enrol an authenticator before using the portal.
  // (mfa is fully loaded by the time AuthedApp renders — AppRoutes awaits it.)
  if (isStaffRole(user) && !mfa.enrolled) return <ForcedMfaSetup />;

  // Hard gate: every user must accept the current Terms before continuing.
  if (user && (user.tos_accepted_version ?? 0) < CURRENT_TOS_VERSION) return <TermsGate />;

  return (
    <AppProvider>
      <ScanProvider>
        <ViewPreferencesProvider>
        <DashboardLayoutProvider>
        <MFAStepUpProvider>
        {/* Non-blocking 2FA nudge for clients without an authenticator. */}
        <ClientMfaNudge />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/scan" element={<ScannerPage />} />
            <Route path="/invoices/new" element={<InvoiceEditor />} />
            <Route path="/invoices/:id" element={<InvoiceEditor />} />
            <Route path="/clients" element={<ClientManager />} />
            <Route path="/clients/deleted" element={<DeletedClients />} />
            <Route path="/clients/smart-import" element={<SmartImport />} />
            <Route path="/clients/duplicates" element={<DuplicateFinder />} />
            <Route path="/clients/unlinked-directors" element={<UnlinkedDirectors />} />
            <Route path="/clients/:id/print" element={<ClientCardPrint />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/compliance" element={<ComplianceDashboard />} />
            <Route path="/tax-filings" element={<TaxFilingsPage />} />
            <Route path="/credentials" element={<CredentialsVault />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/tasks" element={<StaffTasks />} />
            <Route path="/task-templates" element={<TaskTemplates />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/ai-usage" element={<AiUsage />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/timesheet" element={<Timesheet />} />
            <Route path="/timesheet/print" element={<TimesheetPrint />} />
            <Route path="/my-billing" element={<MyBilling />} />
            <Route path="/my-deadlines" element={<MyDeadlines />} />
            <Route path="/my-messages" element={<MyMessages />} />
            <Route path="/my-emails" element={<MyEmails />} />
            <Route path="/my-company" element={<MyCompany />} />
            <Route path="/my-customers" element={<MyCustomers />} />
            <Route path="/sales" element={<SalesInvoices />} />
            <Route path="/sales/receipt/:id/print" element={<CustomerReceiptPrint />} />
            <Route path="/sales/:id/print" element={<CustomerInvoicePrint />} />
            <Route path="/sales/:id" element={<CustomerInvoiceEditor />} />
            <Route path="/debtors" element={<CustomerDebtors />} />
            <Route path="/my-expenses" element={<MyExpenses />} />
            <Route path="/my-scan" element={<MyScanPage />} />
            <Route path="/my-reports" element={<MyReports />} />
            <Route path="/client-expenses" element={<ClientExpenses />} />
            <Route path="/messages" element={<MessagesInbox />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/settings/firm-email" element={<FirmEmailSettings />} />
            <Route path="/bulk-email" element={<BulkEmail />} />
            <Route path="/request-tax-info" element={<RequestTaxInfo />} />
            <Route path="/onboarding-review" element={<ClientIntakeReview />} />
            <Route path="/billing" element={<InvoicesList />} />
            <Route path="/billing/recurring" element={<RecurringInvoices />} />
            <Route path="/billing/age-analysis" element={<AgeAnalysis />} />
            <Route path="/billing/statement" element={<ClientStatement />} />
            <Route path="/billing/statements/print" element={<StatementsBatchPrint />} />
            <Route path="/billing/statement/:clientId/print" element={<StatementPrint />} />
            <Route path="/billing/service-presets" element={<ServicePresets />} />
            <Route path="/billing/reports" element={<SalesReports />} />
            <Route path="/billing/receipt/:id/print" element={<ReceiptPrint />} />
            <Route path="/billing/:id" element={<BillingInvoiceEditor />} />
            <Route path="/billing/:id/print" element={<InvoicePrint />} />
            <Route path="/settings/company" element={<CompanySettings />} />
            <Route path="/settings/email" element={<EmailSettings />} />
            <Route path="/master-accounts" element={<MasterChartOfAccounts />} />
            <Route path="/settings/services" element={<ServiceSettings />} />
            <Route path="/phone-log" element={<PhoneLog />} />
            <Route path="/security" element={<Security />} />
            <Route path="/merge" element={<MergeClients />} />
            {/* Design System v2 verification page — internal, not in sidebar */}
            <Route path="/design-system" element={<DesignSystemDemo />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Route>
        </Routes>
        </MFAStepUpProvider>
        </DashboardLayoutProvider>
        </ViewPreferencesProvider>
      </ScanProvider>
    </AppProvider>
  );
}

function PublicApp() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    // Outer boundary for the standalone public pages below, which render
    // outside AppShell and so can't use its in-panel skeleton. Routes inside
    // AppShell resolve against its own nearer boundary, keeping the sidebar up.
    <Suspense fallback={<div className="loading-screen">Loading…</div>}>
    <Routes>
      {/* Always-public routes */}
      <Route path="/tax" element={<TaxCalculator />} />
      <Route path="/tax-calculator" element={<Navigate to="/tax" replace />} />
      <Route path="/privacy" element={<PrivacyNotice />} />
      <Route path="/signup" element={<SignupApplication />} />
      <Route path="/accept-engagement/:token" element={<EngagementAcceptPage />} />
      <Route path="/client-intake/:token" element={<ClientIntakePage />} />
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Everything else: authed → real app, anonymous → landing */}
      <Route path="/*" element={user ? <AuthedApp /> : <PublicApp />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
