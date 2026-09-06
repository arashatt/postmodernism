import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerServiceWorker, unregisterServiceWorkers } from './lib/pwa.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The worker only exists in a build; in dev, clear one left behind by a
// production build served from the same origin.
if (import.meta.env.PROD) registerServiceWorker();
else unregisterServiceWorkers();
