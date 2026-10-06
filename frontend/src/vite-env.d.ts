/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
  readonly VITE_MOCK_NO_BEV?: string;
  readonly VITE_MOCK_NO_ATLAS?: string;
  readonly VITE_MOCK_NO_DENSE?: string;
  readonly VITE_MOCK_NO_SPLAT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export interface ViewerOptions {
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    rootElement?: HTMLElement | null;
    dropInMode?: boolean;
    camera?: THREE.Camera;
    renderer?: THREE.WebGLRenderer;
    ignoreDevicePixelRatio?: boolean;
    [key: string]: unknown;
  }

  export interface SplatSceneOptions {
    progressiveLoad?: boolean;
    showLoadingUI?: boolean;
    splatAlphaRemovalThreshold?: number;
    format?: number;
    [key: string]: unknown;
  }

  export class SplatMesh extends THREE.Object3D {
    getSplatCount(): number;
    setRenderer(renderer: THREE.WebGLRenderer): void;
  }

  export class Viewer {
    splatMesh: SplatMesh;
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: SplatSceneOptions): Promise<void>;
    update(renderer?: THREE.WebGLRenderer, camera?: THREE.Camera): void;
    dispose(): void;
  }

  export class DropInViewer extends THREE.Group {
    viewer: Viewer;
    splatMesh: SplatMesh | null;
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: SplatSceneOptions): Promise<void>;
    dispose(): void;
  }

  export class PlyParser {
    static parseToUncompressedSplatArray(
      plyBuffer: ArrayBufferLike,
      outSphericalHarmonicsDegree?: number
    ): { splatCount: number; [key: string]: unknown };
    static parseToUncompressedSplatBuffer(
      plyBuffer: ArrayBufferLike,
      outSphericalHarmonicsDegree?: number
    ): { splatCount: number; [key: string]: unknown };
  }
}
