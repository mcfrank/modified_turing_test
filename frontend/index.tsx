import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AdminScreen } from './components/AdminScreen';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/admin') ? <AdminScreen /> : <App />}
  </React.StrictMode>
);