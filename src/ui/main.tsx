import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main style={{ fontFamily: 'monospace', padding: 16 }}>
      <h1>GOAL MODE</h1>
      <p>z/OS performance &amp; capacity roguelike. UI arrives in milestone M6.</p>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
