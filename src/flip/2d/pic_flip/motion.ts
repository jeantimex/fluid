import type { AppState, Vec2 } from './types';

const MAX_GRAVITY = 9.81;

type MotionPermissionState = 'granted' | 'denied' | 'prompt' | 'not-supported';

interface MotionPermissionRequester {
  requestPermission?: () => Promise<MotionPermissionState>;
}

interface MotionControllerCallbacks {
  onGravityChange: (gravity: Vec2) => void;
  onShake: () => void;
  onStateChange: (state: AppState) => void;
}

export class MotionController {
  private gravity: Vec2 = { x: 0, y: -MAX_GRAVITY };
  private lastShakeTime = 0;
  private lastAcceleration = { x: 0, y: 0, z: 0 };
  private readonly shakeThreshold = 15;
  private readonly shakeTimeThreshold = 600;

  constructor(private callbacks: MotionControllerCallbacks) {}

  getGravity(): Vec2 {
    return { ...this.gravity };
  }

  async initialize(): Promise<void> {
    if (!('DeviceOrientationEvent' in window)) {
      this.callbacks.onGravityChange(this.gravity);
      this.callbacks.onStateChange('not-supported');
      return;
    }

    const orientationCtor = window.DeviceOrientationEvent as unknown as MotionPermissionRequester;
    if (typeof orientationCtor.requestPermission === 'function') {
      this.callbacks.onStateChange('needs-permission');
      return;
    }

    this.startListening();
    this.callbacks.onStateChange('ready');
  }

  async requestPermission(): Promise<void> {
    const orientationCtor = window.DeviceOrientationEvent as unknown as MotionPermissionRequester;
    const motionCtor = window.DeviceMotionEvent as unknown as MotionPermissionRequester;

    if (typeof orientationCtor.requestPermission === 'function') {
      try {
        const orientationResponse = await orientationCtor.requestPermission();
        let motionResponse: MotionPermissionState = 'granted';

        if (typeof motionCtor.requestPermission === 'function') {
          motionResponse = await motionCtor.requestPermission();
        }

        if (orientationResponse === 'granted' && motionResponse === 'granted') {
          this.startListening();
          this.callbacks.onStateChange('ready');
        } else {
          this.callbacks.onStateChange('denied');
        }
      } catch (error) {
        console.error('Error requesting device motion/orientation permission:', error);
        this.callbacks.onStateChange('denied');
      }
      return;
    }

    if ('DeviceOrientationEvent' in window) {
      this.startListening();
      this.callbacks.onStateChange('ready');
    } else {
      this.callbacks.onStateChange('not-supported');
    }
  }

  dispose(): void {
    window.removeEventListener('deviceorientation', this.handleOrientationChange);
    window.removeEventListener('devicemotion', this.handleDeviceMotion);
  }

  private startListening(): void {
    window.addEventListener('deviceorientation', this.handleOrientationChange);
    window.addEventListener('devicemotion', this.handleDeviceMotion);
    this.callbacks.onGravityChange(this.gravity);
  }

  private handleDeviceMotion = (event: DeviceMotionEvent): void => {
    if (!event.accelerationIncludingGravity) return;

    const acceleration = event.accelerationIncludingGravity;
    const x = acceleration.x || 0;
    const y = acceleration.y || 0;
    const z = acceleration.z || 0;

    const deltaX = Math.abs(x - this.lastAcceleration.x);
    const deltaY = Math.abs(y - this.lastAcceleration.y);
    const deltaZ = Math.abs(z - this.lastAcceleration.z);
    const totalDelta = deltaX + deltaY + deltaZ;
    const now = Date.now();

    if (
      totalDelta > this.shakeThreshold &&
      now - this.lastShakeTime > this.shakeTimeThreshold
    ) {
      this.callbacks.onShake();
      this.lastShakeTime = now;
    }

    this.lastAcceleration = { x, y, z };
  };

  private handleOrientationChange = (event: DeviceOrientationEvent): void => {
    if (event.beta === null || event.gamma === null) {
      return;
    }

    const betaRad = (event.beta * Math.PI) / 180;
    const gammaRad = (event.gamma * Math.PI) / 180;
    const gx = Math.sin(gammaRad) * Math.cos(betaRad);
    const gy = -Math.sin(betaRad);

    this.gravity = {
      x: MAX_GRAVITY * Math.max(-1, Math.min(1, gx)),
      y: MAX_GRAVITY * Math.max(-1, Math.min(1, gy)),
    };

    this.callbacks.onGravityChange(this.gravity);
  };
}
