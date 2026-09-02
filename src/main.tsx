import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Bundled, not loaded from a CDN - a CDN font request means the app cannot
// start offline, which defeats the point of installing it.
//
// Inter carries the interface. Fraunces carries the headlines, and only the
// weight axis of it: the optical-size file is nearly twice the size for a
// difference nobody would notice at the four places it is used.
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces/wght.css';

import './styles/tokens.css';
import './styles/app.css';
import './styles/components.css';
import './styles/readiness.css';
import './styles/v2.css';
import './styles/v3.css';
import { App } from './App';
import { ensureProfile } from './db/repo';

import { ErrorBoundary } from './ui/ErrorBoundary';
import { ToastProvider } from './ui/ToastProvider';

// Open the database and create the default profile before first paint, so no
// screen has to handle a missing profile.
void ensureProfile();

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
