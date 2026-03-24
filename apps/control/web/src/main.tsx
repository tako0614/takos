import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './providers/I18nProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import './styles.css';

if (import.meta.env.PROD && import.meta.env.MODE !== 'staging-debug') {
  const noop = () => {};
  console.debug = noop;
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>
);
