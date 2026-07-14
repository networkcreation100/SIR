import React from 'react';
import './styles.css';

const SAGE_URL = 'https://app.base44.com/apps/6a5215a50e957bb9c1b81531';

export default function App() {
  return (
    <main className="sage-shell">
      <div className="sage-card">
        <div className="sage-logo">SAGE</div>
        <h1>Opening SAGE…</h1>
        <p>Smart AI for Genius Education</p>
        <a href={SAGE_URL}>Open SAGE</a>
      </div>
    </main>
  );
}
