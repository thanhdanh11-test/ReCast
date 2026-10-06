import React from 'react';

export interface PaneErrorBoundaryProps {
  paneName: string;
  resetKeys?: readonly unknown[];
  children?: React.ReactNode;
  onReset?: () => void;
  fallback?: (props: {
    error: Error;
    reset: () => void;
    paneName: string;
  }) => React.ReactNode;
}

export interface PaneErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function hasResetKeysChanged(
  prev?: readonly unknown[],
  next?: readonly unknown[]
): boolean {
  if (!prev || !next) return prev !== next;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return true;
  }
  return false;
}

export class PaneErrorBoundary extends React.Component<
  PaneErrorBoundaryProps,
  PaneErrorBoundaryState
> {
  constructor(props: PaneErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): PaneErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `[PaneErrorBoundary: ${this.props.paneName}] Error caught:`,
      error,
      errorInfo.componentStack || error.stack
    );
  }

  componentDidUpdate(prevProps: PaneErrorBoundaryProps): void {
    if (this.state.hasError) {
      if (hasResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
        this.reset();
      }
    }
  }

  reset = (): void => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback && this.state.error) {
        return this.props.fallback({
          error: this.state.error,
          reset: this.reset,
          paneName: this.props.paneName,
        });
      }

      const errorMessage =
        this.state.error?.message ||
        String(this.state.error || 'Đã xảy ra lỗi không xác định');

      return (
        <div
          data-testid={`pane-error-${this.props.paneName}`}
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            padding: '16px',
            boxSizing: 'border-box',
            backgroundColor: '#181b24',
            color: '#f87171',
            textAlign: 'center',
            gap: '8px',
            fontSize: '13px',
          }}
        >
          <div style={{ fontWeight: 600, color: '#ef4444' }}>
            {`Lỗi hiển thị ${this.props.paneName}`}
          </div>
          <div
            data-testid={`pane-error-message-${this.props.paneName}`}
            style={{
              color: '#94a3b8',
              fontSize: '12px',
              maxWidth: '90%',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
            }}
          >
            {errorMessage}
          </div>
          <button
            type="button"
            data-testid={`pane-retry-btn-${this.props.paneName}`}
            onClick={this.reset}
            style={{
              marginTop: '4px',
              padding: '4px 12px',
              backgroundColor: '#282e3e',
              color: '#f1f5f9',
              border: '1px solid #3b4252',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Thử lại
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
