// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaneErrorBoundary } from './PaneErrorBoundary';

// Helper component that can conditionally throw
const BuggyChild: React.FC<{ shouldThrow: boolean; message?: string }> = ({
  shouldThrow,
  message = 'Crash in child component',
}) => {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div data-testid="buggy-child-ok">Child rendered successfully</div>;
};

describe('PaneErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when there is no error', () => {
    render(
      <PaneErrorBoundary paneName="TestPane">
        <div data-testid="normal-child">Healthy Content</div>
      </PaneErrorBoundary>
    );

    expect(screen.getByTestId('normal-child')).toBeDefined();
    expect(screen.getByText('Healthy Content')).toBeDefined();
    expect(screen.queryByTestId('pane-error-TestPane')).toBeNull();
  });

  it('một child ném lỗi thì khung đó hiện fallback, còn hai khung kia vẫn render', () => {
    render(
      <div data-testid="multi-pane-container">
        {/* Pane 1: TopView throws error */}
        <PaneErrorBoundary paneName="TopView" resetKeys={['frame_000']}>
          <BuggyChild shouldThrow={true} message="TopView BEV dimension mismatch" />
        </PaneErrorBoundary>

        {/* Pane 2: ThreeView normal */}
        <PaneErrorBoundary paneName="ThreeView" resetKeys={['frame_000']}>
          <div data-testid="three-view-content">3D ThreeView Canvas Active</div>
        </PaneErrorBoundary>

        {/* Pane 3: CameraGrid normal */}
        <PaneErrorBoundary paneName="CameraGrid" resetKeys={['frame_000']}>
          <div data-testid="camera-grid-content">CameraGrid 6 Cameras Active</div>
        </PaneErrorBoundary>
      </div>
    );

    // TopView should display isolated fallback
    expect(screen.getByTestId('pane-error-TopView')).toBeDefined();
    expect(screen.getByText('Lỗi hiển thị TopView')).toBeDefined();
    expect(
      screen.getByText('TopView BEV dimension mismatch')
    ).toBeDefined();
    expect(screen.getByTestId('pane-retry-btn-TopView')).toBeDefined();

    // ThreeView and CameraGrid should remain intact and rendering
    expect(screen.getByTestId('three-view-content')).toBeDefined();
    expect(screen.getByText('3D ThreeView Canvas Active')).toBeDefined();
    expect(screen.getByTestId('camera-grid-content')).toBeDefined();
    expect(screen.getByText('CameraGrid 6 Cameras Active')).toBeDefined();

    // Verify console.error was called with stack
    expect(consoleErrorSpy).toHaveBeenCalled();
    const calls = consoleErrorSpy.mock.calls;
    const hasTopViewLog = calls.some((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('TopView'))
    );
    expect(hasTopViewLog).toBe(true);
  });

  it('bấm "Thử lại" sau khi lỗi hết thì child render lại', () => {
    const TestContainer: React.FC<{ fail: boolean }> = ({ fail }) => {
      return (
        <PaneErrorBoundary paneName="DynamicPane">
          <BuggyChild shouldThrow={fail} message="Temporary glitch" />
        </PaneErrorBoundary>
      );
    };

    const { rerender } = render(<TestContainer fail={true} />);

    // Initially fails
    expect(screen.getByTestId('pane-error-DynamicPane')).toBeDefined();
    expect(screen.getByText('Lỗi hiển thị DynamicPane')).toBeDefined();
    expect(screen.getByText('Temporary glitch')).toBeDefined();

    // Rerender parent with error resolved (props updated, boundary still in error state until reset)
    rerender(<TestContainer fail={false} />);
    expect(screen.getByTestId('pane-error-DynamicPane')).toBeDefined();

    // Click "Thử lại" button
    const retryBtn = screen.getByTestId('pane-retry-btn-DynamicPane');
    expect(retryBtn.textContent).toBe('Thử lại');
    fireEvent.click(retryBtn);

    // Verify child is rendered again
    expect(screen.queryByTestId('pane-error-DynamicPane')).toBeNull();
    expect(screen.getByTestId('buggy-child-ok')).toBeDefined();
    expect(screen.getByText('Child rendered successfully')).toBeDefined();
  });

  it('đổi frameId thì boundary tự reset theo resetKeys', () => {
    interface FrameAppProps {
      frameId: string;
    }

    const FrameChild: React.FC<{ frameId: string }> = ({ frameId }) => {
      if (frameId === 'scene-0061_000000') {
        throw new Error('Corrupted frame 000000 points');
      }
      return <div data-testid="frame-ok">Frame {frameId} rendered</div>;
    };

    const AppContainer: React.FC<FrameAppProps> = ({ frameId }) => {
      return (
        <PaneErrorBoundary paneName="TopView" resetKeys={[frameId]}>
          <FrameChild frameId={frameId} />
        </PaneErrorBoundary>
      );
    };

    const { rerender } = render(<AppContainer frameId="scene-0061_000000" />);

    // Frame 0 fails and shows fallback
    expect(screen.getByTestId('pane-error-TopView')).toBeDefined();
    expect(screen.getByText('Lỗi hiển thị TopView')).toBeDefined();
    expect(screen.getByText('Corrupted frame 000000 points')).toBeDefined();

    // User navigates to next frame -> frameId changes to scene-0061_000001
    rerender(<AppContainer frameId="scene-0061_000001" />);

    // Boundary automatically resets on frameId change
    expect(screen.queryByTestId('pane-error-TopView')).toBeNull();
    expect(screen.getByTestId('frame-ok')).toBeDefined();
    expect(screen.getByText('Frame scene-0061_000001 rendered')).toBeDefined();
  });

  it('isolates error in individual camera tile when wrapped in PaneErrorBoundary', () => {
    render(
      <div>
        <PaneErrorBoundary paneName="CAM_FRONT">
          <BuggyChild shouldThrow={true} message="Matrix projection singular" />
        </PaneErrorBoundary>
        <PaneErrorBoundary paneName="CAM_BACK">
          <div data-testid="cam-back-ok">CAM_BACK Image Ready</div>
        </PaneErrorBoundary>
      </div>
    );

    // CAM_FRONT in error state
    expect(screen.getByTestId('pane-error-CAM_FRONT')).toBeDefined();
    expect(screen.getByText('Lỗi hiển thị CAM_FRONT')).toBeDefined();

    // CAM_BACK healthy
    expect(screen.getByTestId('cam-back-ok')).toBeDefined();
    expect(screen.getByText('CAM_BACK Image Ready')).toBeDefined();
  });

  it('calls onReset callback when reset is invoked', () => {
    const onResetSpy = vi.fn();
    render(
      <PaneErrorBoundary paneName="CallbackPane" onReset={onResetSpy}>
        <BuggyChild shouldThrow={true} message="Failure" />
      </PaneErrorBoundary>
    );

    const retryBtn = screen.getByTestId('pane-retry-btn-CallbackPane');
    fireEvent.click(retryBtn);

    expect(onResetSpy).toHaveBeenCalledTimes(1);
  });

  it('renders custom fallback when fallback prop is provided', () => {
    render(
      <PaneErrorBoundary
        paneName="CustomPane"
        fallback={({ error, reset, paneName }) => (
          <div data-testid="custom-fallback">
            <span>Custom: {paneName}</span>
            <span>Reason: {error.message}</span>
            <button onClick={reset}>Custom Retry</button>
          </div>
        )}
      >
        <BuggyChild shouldThrow={true} message="Custom Error" />
      </PaneErrorBoundary>
    );

    expect(screen.getByTestId('custom-fallback')).toBeDefined();
    expect(screen.getByText('Custom: CustomPane')).toBeDefined();
    expect(screen.getByText('Reason: Custom Error')).toBeDefined();
  });
});

