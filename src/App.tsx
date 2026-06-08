import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { ScanProvider } from './context/ScanContext';
import { MFAStepUpProvider } from './context/MFAStepUpContext';
import { ViewPreferencesProvider } from './context/ViewPreferencesContext';
import { DashboardLayoutProvider } from './context/DashboardLayoutContext';
import AppShell from './components/Layout/AppShell';
import LoginPage from './components/Auth/LoginPage';
import Dashboard from './components/Dashboard';
import ScannerPage from './components/Scanner/ScannerPage';
import InvoiceEditor from './components/Invoice/InvoiceEditor';
import ClientManager from './components/Client/ClientManager';
import ClientDetail from './components/Client/ClientDetail';
import ClientCardPrint from './components/Client/ClientCardPrint';
import SmartImport from './components/Admin/SmartImport';
import TaxFilingsPage from './components/Admin/TaxFilingsPage';
import UnlinkedDirectors from './components/Admin/UnlinkedDirectors';
import CredentialsVault from './components/Admin/CredentialsVault';
import ExportPage from './components/Export/ExportPage';
import DocumentsPage from './components/Documents/DocumentsPage';
import UserManagement from './components/Admin/UserManagement';
import ComplianceDashboard from './components/Admin/ComplianceDashboard';
import AuditLog from './components/Admin/AuditLog';
import StaffTasks from './components/Admin/StaffTasks';
import TaskTemplates from './components/Admin/TaskTemplates';
import Reports from './components/Admin/Reports';
import Calendar from './components/Admin/Calendar';
import Timesheet from './components/Admin/Timesheet';
import TimesheetPrint from './components/Admin/TimesheetPrint';
import CompanySettings from './components/Admin/CompanySettings';
import MasterChartOfAccounts from './components/Admin/MasterChartOfAccounts';
import ServiceSettings from './components/Admin/ServiceSettings';
import EmailSettings from './components/Settings/EmailSettings';
import InvoicesList from './components/Billing/InvoicesList';
import BillingInvoiceEditor from './components/Billing/InvoiceEditor';
import InvoicePrint from './components/Billing/InvoicePrint';
import RecurringInvoices from './components/Billing/RecurringInvoices';
import ReceiptPrint from './components/Billing/ReceiptPrint';
import AgeAnalysis from './components/Billing/AgeAnalysis';
import ClientStatement from './components/Billing/ClientStatement';
import StatementPrint from './components/Billing/StatementPrint';
import StatementsBatchPrint from './components/Billing/StatementsBatchPrint';
import ServicePresets from './components/Billing/ServicePresets';
import SalesReports from './components/Billing/SalesReports';
import MyBilling from './components/Client/MyBilling';
import MyDeadlines from './components/Client/MyDeadlines';
import MyMessages from './components/Client/MyMessages';
import MessagesInbox from './components/Admin/MessagesInbox';
import MyCompany from './components/Client/MyCompany';
import MyCustomers from './components/Client/MyCustomers';
import SalesInvoices from './components/Client/SalesInvoices';
import CustomerInvoiceEditor from './components/Client/CustomerInvoiceEditor';
import CustomerInvoicePrint from './components/Client/CustomerInvoicePrint';
import CustomerReceiptPrint from './components/Client/CustomerReceiptPrint';
import CustomerDebtors from './components/Client/CustomerDebtors';
import MyExpenses from './components/Client/MyExpenses';
import MyScanPage from './components/Client/MyScanPage';
import ClientExpenses from './components/Admin/ClientExpenses';
import MyReports from './components/Client/MyReports';
import AiUsage from './components/Admin/AiUsage';
import PhoneLog from './components/Admin/PhoneLog';
import Security from './components/Admin/Security';
import DeletedClients from './components/Admin/DeletedClients';
import MergeClients from './components/Client/MergeClients';
import LandingPage from './components/Public/LandingPage';
import TaxCalculator from './components/Public/TaxCalculator';
import PrivacyNotice from './components/Public/PrivacyNotice';
import SignupApplication from './components/Public/SignupApplication';
import Applications from './components/Admin/Applications';
import MFAChallenge from './components/Auth/MFAChallenge';
import ForcedMfaSetup from './components/Auth/ForcedMfaSetup';
import TermsGate from './components/Auth/TermsGate';
import { CURRENT_TOS_VERSION } from './components/Auth/terms';
import { isStaffRole } from './services/api';
import DesignSystemDemo from './components/_design/DesignSystemDemo';

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
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/scan" element={<ScannerPage />} />
            <Route path="/invoices/new" element={<InvoiceEditor />} />
            <Route path="/invoices/:id" element={<InvoiceEditor />} />
            <Route path="/clients" element={<ClientManager />} />
            <Route path="/clients/deleted" element={<DeletedClients />} />
            <Route path="/clients/smart-import" element={<SmartImport />} />
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
    <Routes>
      {/* Always-public routes */}
      <Route path="/tax" element={<TaxCalculator />} />
      <Route path="/tax-calculator" element={<Navigate to="/tax" replace />} />
      <Route path="/privacy" element={<PrivacyNotice />} />
      <Route path="/signup" element={<SignupApplication />} />
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />

      {/* Everything else: authed → real app, anonymous → landing */}
      <Route path="/*" element={user ? <AuthedApp /> : <PublicApp />} />
    </Routes>
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
