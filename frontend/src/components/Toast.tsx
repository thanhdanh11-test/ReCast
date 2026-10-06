import React from 'react';

export interface ToastMessage {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  commandToRun?: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 10000,
        maxWidth: '460px',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            borderRadius: '6px',
            backgroundColor:
              toast.type === 'error'
                ? '#450a0a'
                : toast.type === 'warning'
                ? '#422006'
                : '#082f49',
            border: `1px solid ${
              toast.type === 'error'
                ? '#991b1b'
                : toast.type === 'warning'
                ? '#a16207'
                : '#0284c7'
            }`,
            color: '#f8fafc',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            fontSize: '13px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              {toast.type === 'error'
                ? '⚠️ Error'
                : toast.type === 'warning'
                ? '⚡ Notice'
                : 'ℹ️ Info'}
            </div>
            <div>{toast.message}</div>
            {toast.commandToRun && (
              <pre
                style={{
                  marginTop: '8px',
                  padding: '6px 8px',
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: '#38bdf8',
                  overflowX: 'auto',
                }}
              >
                {toast.commandToRun}
              </pre>
            )}
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              background: 'transparent',
              color: '#94a3b8',
              fontSize: '16px',
              padding: '2px',
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
