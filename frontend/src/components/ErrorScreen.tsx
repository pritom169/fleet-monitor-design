import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router';
import css from './ErrorScreen.module.css';

export function CrashView({ error, onReload = () => location.reload() }: { error: unknown; onReload?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className={`wrap ${css.main}`} role="alert">
      <h1 className={`headline ${css.h1}`}>
        This view stopped working. <span className="ctx">Reload to start it again. The robots and the fleet server are not affected.</span>
      </h1>
      <p className={css.actions}>
        <button type="button" className={css.reload} onClick={onReload}>Reload</button>
        <a className="more" href="/">Fleet overview <span aria-hidden="true">›</span></a>
      </p>
      <details className={css.details}>
        <summary>Technical details</summary>
        <pre>{message}</pre>
      </details>
    </main>
  );
}

export function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    console.error('[fleet] a view crashed', error);
  }, [error]);
  return <CrashView error={error} />;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[fleet] the app crashed', error, info.componentStack);
  }

  render() {
    return this.state.failed ? <CrashView error={this.state.error} /> : this.props.children;
  }
}
