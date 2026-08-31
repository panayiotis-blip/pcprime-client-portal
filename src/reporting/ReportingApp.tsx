// The reporting platform's route tree.
//
// There is ONE application and it is the template. This file signs a person in,
// holds the session and hands over; it renders no screens of its own.
//
// It used to render a great many. A left rail, a Data import, a Reports screen,
// a Review screen, an Account mapping screen — a second application standing in
// front of the first, reached by "Manage the data" and with no way back to the
// report. The template already has every one of those screens, written to the
// specification, and the ones here were worse copies a person could get stuck
// in. They are gone.
//
// If a screen is wanted, it goes in the prototype and the template is rebuilt
// from it. Writing one here is building the second application again.
//
// Staff only. The database says so too — every reporting policy goes through
// reporting.staff_can_access() — so this guard is the courtesy of a clear
// message rather than the control itself.

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStaffRole } from '../services/api';
import { ReportingSession } from './session';
import ReportHome from './pages/ReportHome';
import ReportingSetup from './pages/ReportingSetup';

export default function ReportingApp() {
  const { user } = useAuth();
  if (!isStaffRole(user)) return <Navigate to="/" replace />;
  return (
    <ReportingSession>
      <Routes>
        {/* Which clients are reported on, and under which BTMS company. The one
            exception to a session being about a single client, and the reason
            it lives outside the template rather than inside it. */}
        <Route path="/setup" element={<ReportingSetup />} />
        {/* Everything else is the report, full screen. */}
        <Route path="*" element={<ReportHome />} />
      </Routes>
    </ReportingSession>
  );
}
