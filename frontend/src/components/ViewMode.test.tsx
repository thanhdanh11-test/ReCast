import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from '../App';

class MockStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

describe('2D | Bird | Surround mode switcher (SPEC-P09 §3 & H23)', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const storage = new MockStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  it('renders 2D | Bird | Surround switcher in top-left pane with buttons and active 2D mode by default', () => {
    const html = renderToString(<App />);

    expect(html).toContain('data-testid="topview-mode-toggle"');
    expect(html).toContain('data-testid="mode-2d-btn"');
    expect(html).toContain('data-testid="mode-bird-btn"');
    expect(html).toContain('data-testid="mode-surround-btn"');
    expect(html).toContain('>2D</button>');
    expect(html).toContain('>Bird</button>');
    expect(html).toContain('>Surround</button>');
  });

  it('persists and restores view mode to/from localStorage within try/catch', () => {
    globalThis.localStorage.setItem('topeye_top_view_mode', 'Bird');
    const htmlBird = renderToString(<App />);
    expect(htmlBird).toContain('data-testid="bird-view-container"');

    globalThis.localStorage.setItem('topeye_top_view_mode', 'Surround');
    const htmlSurround = renderToString(<App />);
    expect(htmlSurround).toContain('data-testid="surround-view-container"');

    globalThis.localStorage.setItem('topeye_top_view_mode', '2D');
    const html2D = renderToString(<App />);
    expect(html2D).not.toContain('data-testid="bird-view-container"');
    expect(html2D).not.toContain('data-testid="surround-view-container"');
  });
});
