import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { EmptyState, PageLoader } from './components/ui';
import Home from './pages/Home';

// Code-Splitting: Support- und Admin-Bereich werden nur bei Bedarf geladen
const Catalog = lazy(() => import('./pages/Catalog'));
const RequestForm = lazy(() => import('./pages/RequestForm'));
const MyTickets = lazy(() => import('./pages/MyTickets'));
const TicketDetail = lazy(() => import('./pages/TicketDetail'));
const SupportQueue = lazy(() => import('./pages/SupportQueue'));
const Admin = lazy(() => import('./pages/Admin'));

function Forbidden() {
  return (
    <EmptyState icon="lock" title="Kein Zugriff">
      <p>Für diesen Bereich fehlt Ihnen die erforderliche Rolle. Wenden Sie sich bei Bedarf an die IT-Administration.</p>
      <Link className="btn tonal" to="/">Zur Startseite</Link>
    </EmptyState>
  );
}

function NotFound() {
  return (
    <EmptyState icon="search" title="Seite nicht gefunden">
      <Link className="btn tonal" to="/">Zur Startseite</Link>
    </EmptyState>
  );
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/katalog" element={<Catalog />} />
          <Route path="/katalog/:categoryId" element={<Catalog />} />
          <Route path="/anfrage/:itemId" element={<RequestForm />} />
          <Route path="/tickets" element={<MyTickets />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/support" element={<RequireRole roles={['first-level', 'admin']}><SupportQueue /></RequireRole>} />
          <Route path="/support/tickets/:id" element={<RequireRole roles={['first-level', 'admin']}><TicketDetail supportView /></RequireRole>} />
          <Route path="/admin/*" element={<RequireRole roles={['admin']}><Admin /></RequireRole>} />
          <Route path="/403" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
