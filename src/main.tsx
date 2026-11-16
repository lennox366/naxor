import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import './theme-mono.css';

// Globale Sicherheitsnetze: nicht abgefangene Fehler dürfen die App nicht crashen
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unbehandelte Promise-Ablehnung:', e.reason);
});
window.addEventListener('error', (e) => {
  console.error('Unbehandelter Fehler:', e.error || e.message);
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
