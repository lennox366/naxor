import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('NAXORA: Renderer-Fehler', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050607', color: '#eef0f4', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 480, padding: 32, border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, background: 'rgba(255,255,255,.04)' }}>
          <AlertTriangle size={28} style={{ color: '#d8dade', marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Ein Bereich der App ist abgestürzt</h2>
          <p style={{ color: '#a7adb8', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            <RotateCcw size={14} /> Neu starten
          </button>
        </div>
      </div>
    );
  }
}
