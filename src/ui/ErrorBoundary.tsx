import { Component, type ReactNode } from 'react';

/** Keeps a crash in one tab from blanking the whole app, and shows what broke so it can be reported. */
export class ErrorBoundary extends Component<{ where: string; onReset: () => void; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(`GOAL MODE: ${this.props.where} crashed`, error);
  }

  override render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const details = `${this.props.where}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 8).join('\n')}`;
    return (
      <div className="panel">
        <h3>Something broke in the {this.props.where}</h3>
        <p className="muted">The game is still running. Go back to the console, or try this tab again; if it keeps happening, the details below help fix it.</p>
        <div className="form">
          <button
            className="primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Back to the Ops Console
          </button>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
          <button onClick={() => void navigator.clipboard?.writeText(details).catch(() => {})}>Copy details</button>
        </div>
        <pre className="green" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {details}
        </pre>
      </div>
    );
  }
}
