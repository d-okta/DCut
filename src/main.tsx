import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { useProject } from './store/projectStore';
import { useUi } from './store/uiStore';
import { bridge } from './bridge';

// Hook debug (hanya mode dev): akses store dari console/otomasi.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__nusacut = { useProject, useUi, bridge };
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
