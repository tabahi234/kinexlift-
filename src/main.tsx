import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Bundled, not loaded from a CDN - a CDN font request means the app cannot
// start offline, which defeats the point of installing it.
import '@fontsource-variable/inter';

import './styles/tokens.css';
import './styles/app.css';
import './styles/components.css';
import './styles/readiness.css';
import { App } from './App';
import { ensureProfile } from './db/repo';

// Open the database and create the default profile before first paint, so no
// screen has to handle a missing profile.
void ensureProfile();

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
