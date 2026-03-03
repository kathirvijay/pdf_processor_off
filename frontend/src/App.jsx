import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { WakaEntryProvider, useWakaEntry } from './contexts/WakaEntryContext';
import WakaEntryGuard from './components/WakaEntryGuard';
import ToastContainer from './components/Toast';
import TemplateEditor from './pages/TemplateEditor';
import TemplateAdmin from './pages/TemplateAdmin';

function AppContent() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <header className="app-header-unified">
        <div className="app-header-nav">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>Template Editor</NavLink>
          <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>Admin</NavLink>
        </div>
        <div id="app-header-toolbar" className="app-header-toolbar" />
      </header>
      <div className="app-content">
        <Routes>
          <Route path="/" element={<TemplateEditor />} />
          <Route path="/admin" element={<TemplateAdmin />} />
        </Routes>
      </div>
      <ToastContainer />
    </BrowserRouter>
  </ToastProvider>
  );
}

function App() {
  return (
    <WakaEntryProvider>
      <WakaEntryGuard>
        <AppContent />
      </WakaEntryGuard>
    </WakaEntryProvider>
  );
}

export default App;
export { useWakaEntry };
