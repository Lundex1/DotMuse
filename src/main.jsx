import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import FloatBoard from './components/FloatBoard.jsx';
import './styles.css';

const params = new URLSearchParams(location.search);
const root = createRoot(document.getElementById('root'));

if (params.get('float') === 'board') {
  root.render(<FloatBoard boardId={Number(params.get('id'))} />);
} else {
  root.render(<App />);
}
