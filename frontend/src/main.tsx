import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { SnackbarProvider } from './components/ui';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/tokens.css';
import './theme/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <SnackbarProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </SnackbarProvider>
    </ThemeProvider>
  </StrictMode>,
);
