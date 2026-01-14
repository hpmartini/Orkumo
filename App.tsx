/**
 * Dashboard Application Entry Point
 *
 * This is the DASHBOARD-ONLY app (no landing page).
 * Routes:
 *   / -> Dashboard home
 *   /:projectName/:projectId -> Project detail view
 *
 * For the full app with landing page, see index.tsx (full deployment).
 * For standalone dashboard, see dashboard.tsx (standalone deployment).
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { DashboardContent } from './components/Dashboard/DashboardContent';

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<DashboardContent />} />
      <Route path="/:projectName/:projectId" element={<DashboardContent />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
