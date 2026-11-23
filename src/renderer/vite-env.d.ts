/// <reference types="vite/client" />
import type { ControlCenterAPI } from '../preload/index';

declare global {
  interface Window {
    pwControlCenter: ControlCenterAPI;
  }
}
