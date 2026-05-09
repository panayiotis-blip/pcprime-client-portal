import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { ScanProvider } from './context/ScanContext';
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
import MergeClients from './components/Client/MergeClients';
import LandingPage from './components/Public/LandingPage';
import TaxCalculator from './components/Public/TaxCalculator';

function AuthedApp() {
  return (
    <AppProvider>
      <ScanProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/scan" element={<ScannerPage />} />
            <Route path="/invoices" element={<InvoiceList />} />
            <Route path="/invoices/new" element={<InvoiceEditor />} />
            <Route path="/invoices/:id" element={<InvoiceEditor />} />
            <Route path="/clients" element={<ClientManager />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/compliance" element={<ComplianceDashboard />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/merge" element={<MergeClients />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Route>
        </Routes>
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
