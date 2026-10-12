import { Component, lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Skeleton } from "./components/ui";
import { useAuth } from "./store/auth";
import { socket } from "./store/market";
import { useUi } from "./store/ui";
import { AuthPage } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";

const MarketPage = lazy(() => import("./pages/Market").then((m) => ({ default: m.MarketPage })));
const SymbolPage = lazy(() => import("./pages/Symbol").then((m) => ({ default: m.SymbolPage })));
const WatchlistPage = lazy(() => import("./pages/Watchlist").then((m) => ({ default: m.WatchlistPage })));
const PortfolioPage = lazy(() => import("./pages/Portfolio").then((m) => ({ default: m.PortfolioPage })));
const OrdersPage = lazy(() => import("./pages/Orders").then((m) => ({ default: m.OrdersPage })));
const PositionsPage = lazy(() => import("./pages/Positions").then((m) => ({ default: m.PositionsPage })));
const AnalyticsPage = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.AnalyticsPage })));
const ScreenerPage = lazy(() => import("./pages/Screener").then((m) => ({ default: m.ScreenerPage })));
const NewsPage = lazy(() => import("./pages/News").then((m) => ({ default: m.NewsPage })));
const CalendarPage = lazy(() => import("./pages/Calendar").then((m) => ({ default: m.CalendarPage })));
const SocialPage = lazy(() => import("./pages/Social").then((m) => ({ default: m.SocialPage })));
const ProfilePage = lazy(() => import("./pages/Social").then((m) => ({ default: m.ProfilePage })));
const OptionsPage = lazy(() => import("./pages/Options").then((m) => ({ default: m.OptionsPage })));
const BacktesterPage = lazy(() => import("./pages/Backtester").then((m) => ({ default: m.BacktesterPage })));
const StressPage = lazy(() => import("./pages/StressTest").then((m) => ({ default: m.StressPage })));
const PredictionsPage = lazy(() => import("./pages/Predictions").then((m) => ({ default: m.PredictionsPage })));
const JournalPage = lazy(() => import("./pages/Journal").then((m) => ({ default: m.JournalPage })));
const CompetitionsPage = lazy(() => import("./pages/Competitions").then((m) => ({ default: m.CompetitionsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.HelpPage })));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error)
      return (
        <div className="card card-pad">
          <h2>Something went wrong on this page</h2>
          <p className="muted">{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    return this.props.children;
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  const loc = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

function Page({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary key={loc.pathname}>
      <Suspense fallback={<div className="col gap-12"><Skeleton h={28} w={240} /><Skeleton h={320} /></div>}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  const theme = useUi((s) => s.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { socket.start(); return () => socket.stop(); }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Page><Dashboard /></Page>} />
          <Route path="market" element={<Page><MarketPage /></Page>} />
          <Route path="market/:symbol" element={<Page><SymbolPage /></Page>} />
          <Route path="watchlist" element={<Page><WatchlistPage /></Page>} />
          <Route path="portfolio" element={<Page><PortfolioPage /></Page>} />
          <Route path="orders" element={<Page><OrdersPage /></Page>} />
          <Route path="positions" element={<Page><PositionsPage /></Page>} />
          <Route path="analytics" element={<Page><AnalyticsPage /></Page>} />
          <Route path="screener" element={<Page><ScreenerPage /></Page>} />
          <Route path="news" element={<Page><NewsPage /></Page>} />
          <Route path="calendar" element={<Page><CalendarPage /></Page>} />
          <Route path="social" element={<Page><SocialPage /></Page>} />
          <Route path="u/:username" element={<Page><ProfilePage /></Page>} />
          <Route path="options" element={<Page><OptionsPage /></Page>} />
          <Route path="backtester" element={<Page><BacktesterPage /></Page>} />
          <Route path="stress-test" element={<Page><StressPage /></Page>} />
          <Route path="predictions" element={<Page><PredictionsPage /></Page>} />
          <Route path="journal" element={<Page><JournalPage /></Page>} />
          <Route path="competitions" element={<Page><CompetitionsPage /></Page>} />
          <Route path="settings" element={<Page><SettingsPage /></Page>} />
          <Route path="help" element={<Page><HelpPage /></Page>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
