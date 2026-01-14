/**
 * Standalone Dashboard Entry Point
 *
 * This file serves as the entry point for the standalone dashboard deployment.
 * It only includes dashboard functionality (no landing page).
 *
 * Routes:
 *   / -> Dashboard home
 *   /:projectName/:projectId -> Project detail view
 *
 * Deployment modes:
 * 1. Full app (FullApp.tsx): Landing page at / + Dashboard at /dashboard
 * 2. Standalone dashboard (DashboardApp.tsx): Dashboard only at /
 * 3. Standalone landing (landing.tsx): Landing page only
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { DashboardContent } from './components/Dashboard/DashboardContent';

function DashboardRouter() {
  return (
    <Routes>
      <Route path="/" element={<DashboardContent />} />
      <Route path="/:projectName/:projectId" element={<DashboardContent />} />
    </Routes>
  );
}

export default function DashboardApp() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <DashboardRouter />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
