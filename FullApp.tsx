/**
 * Full Application Entry Point (Landing + Dashboard)
 *
 * This app includes BOTH the landing page and dashboard.
 * Routes:
 *   / -> Landing page
 *   /dashboard -> Dashboard home
 *   /dashboard/:projectName/:projectId -> Project detail view
 *
 * This is used for the unified deployment (index.html -> index.tsx).
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { LandingPage } from './components/Landing';
import { DashboardContent } from './components/Dashboard/DashboardContent';

function FullAppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard" element={<DashboardContent />} />
      <Route path="/dashboard/:projectName/:projectId" element={<DashboardContent />} />
    </Routes>
  );
}

export default function FullApp() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <FullAppRouter />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
