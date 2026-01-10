/**
 * Standalone Dashboard Entry Point
 *
 * This file serves as the entry point for the standalone dashboard deployment.
 * It reuses the AppContent component from App.tsx but with simplified routing
 * (no landing page, dashboard at root path).
 *
 * Deployment modes:
 * 1. Full app (App.tsx): Landing page at / + Dashboard at /dashboard
 * 2. Standalone dashboard (DashboardApp.tsx): Dashboard only at /
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components';
import { AppContent } from './App';

function DashboardRouter() {
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/:projectName/:projectId" element={<AppContent />} />
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
