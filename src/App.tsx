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
import InvoiceList from './components/Invoice/InvoiceList';
import InvoiceEditor from './components/Invoice/InvoiceEditor';
import ClientManager from './components/Client/ClientManager';
import ClientDetail from './components/Client/ClientDetail';
import ExportPage from './components/Export/ExportPage';
import DocumentsPage from './components/Documents/DocumentsPage';
import UserManagement from './components/Admin/UserManagement';
import ComplianceDashboard from './components/Admin/ComplianceDashboard';
import AuditLog from './components/Admin/AuditLog';
import StaffTasks from './components/Admin/StaffTasks';
import TaskTemplates from './components/Admin/TaskTemplates';
import Reports from './components/Admin/Reports';
import Calendar from './components/Admin/Calendar';
import PhoneLog from './components/Admin/PhoneLog';
import Security from './components/Admin/Security';
import DeletedClients from './components/Admin/DeletedClients';
import MergeClients from './components/Client/MergeClients';
import LandingPage from './components/Public/LandingPage';
import TaxCalculator from './components/Public/TaxCalculator';
import PrivacyNotice from './components/Public/PrivacyNotice';
import MFAChallenge from './components/Auth/MFAChallenge';

function AuthedApp() {
  const { mfa } = useAuth();

  // Hard gate: if the user has MFA enrolled but the session is at aal1,
  // block the entire app behind the 6-digit challenge — unless this device
  // has been marked as trusted (then the prompt is skipped).
  if (mfa.challenge_required && !mfa.trusted_device_validated) return <MFAChallenge />;

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
            <Route path="/invoices" element={<InvoiceList />} />
            <Route path="/invoices/new" element={<InvoiceEditor />} />
            <Route path="/invoices/:id" element={<InvoiceEditor />} />
            <Route path="/clients" element={<ClientManager />} />
            <Route path="/clients/deleted" element={<DeletedClients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/compliance" element={<ComplianceDashboard />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/tasks" element={<StaffTasks />} />
            <Route path="/task-templates" element={<TaskTemplates />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/phone-log" element={<PhoneLog />} />
            <Route path="/security" element={<Security />} />
            <Route path="/merge" element={<MergeClients />} />
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
