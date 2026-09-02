import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="app" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-4)', gap: 'var(--space-4)', minHeight: '100vh', justifyContent: 'center' }}>
          <section className="card">
            <header style={{ textAlign: 'center' }}>
              <h2>Page Not Found or Crashed</h2>
              <p className="hint">
                We ran into an unexpected error or the page you are looking for doesn't exist.
              </p>
            </header>
            
            <div className="message error" style={{ wordBreak: 'break-word', marginTop: 'var(--space-4)' }}>
              {this.state.error?.message || 'Unknown error'}
            </div>

            <div className="btn-row" style={{ marginTop: 'var(--space-5)' }}>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => window.location.reload()}
              >
                Restart App
              </button>
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
