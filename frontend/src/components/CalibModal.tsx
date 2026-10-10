import React from 'react';
import { CalibReport } from '../api/types';

interface CalibModalProps {
  report: CalibReport | null;
  onClose: () => void;
}

export const CalibModal: React.FC<CalibModalProps> = ({ report, onClose }) => {
  if (!report) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#0c0c0c',
          borderRadius: '8px',
          border: '1px solid #1f2937',
          padding: '20px 24px',
          width: '420px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '18px', color: '#f1f5f9' }}>
            Calibration Report
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: '#94a3b8',
              fontSize: '18px',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: '#94a3b8' }}>Overall Verdict:</span>
          <span
            style={{
              fontWeight: 600,
              fontSize: '14px',
              textTransform: 'uppercase',
              color:
                report.verdict === 'ok'
                  ? '#22c55e'
                  : report.verdict === 'warning'
                  ? '#eab308'
                  : '#ef4444',
            }}
          >
            ● {report.verdict}
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1f2937', color: '#94a3b8', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>Camera</th>
              <th style={{ padding: '8px 4px' }}>dt (ms)</th>
              <th style={{ padding: '8px 4px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.cameras).map(([cam, info]) => (
              <tr key={cam} style={{ borderBottom: '1px solid #282d3b' }}>
                <td style={{ padding: '8px 4px', fontFamily: 'monospace', color: '#cbd5e1' }}>
                  {cam}
                </td>
                <td style={{ padding: '8px 4px', color: '#e2e8f0' }}>
                  {info.dt_ms.toFixed(2)}
                </td>
                <td style={{ padding: '8px 4px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor:
                        info.status === 'ok'
                          ? '#14532d'
                          : info.status === 'warning'
                          ? '#713f12'
                          : '#7f1d1d',
                      color:
                        info.status === 'ok'
                          ? '#86efac'
                          : info.status === 'warning'
                          ? '#fde047'
                          : '#fca5a5',
                    }}
                  >
                    {info.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
