import type { AppState, Vec2 } from './types';

const DEFAULT_GRAVITY = 9.81;

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
  private gravity: Vec2 = { x: 0, y: -DEFAULT_GRAVITY };
  private gravityMagnitude = DEFAULT_GRAVITY;
  private normalizedDirection: Vec2 = { x: 0, y: -1 };
  private lastShakeTime = 0;
  private lastAcceleration = { x: 0, y: 0, z: 0 };
  private readonly shakeThreshold = 15;
  private readonly shakeTimeThreshold = 600;
  private hasReceivedMotionData = false;
  private motionCheckTimeout: number | null = null;

  constructor(private callbacks: MotionControllerCallbacks) {}

  hasMotionSupport(): boolean {
    return this.hasReceivedMotionData;
  }

  setGravityMagnitude(magnitude: number): void {
    this.gravityMagnitude = magnitude;
    this.gravity = {
      x: this.normalizedDirection.x * magnitude,
      y: this.normalizedDirection.y * magnitude,
    };
    this.callbacks.onGravityChange(this.gravity);
  }

  getGravityMagnitude(): number {
    return this.gravityMagnitude;
  }

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
    if (this.motionCheckTimeout) {
      clearTimeout(this.motionCheckTimeout);
      this.motionCheckTimeout = null;
    }
    window.removeEventListener('deviceorientation', this.handleOrientationChange);
    window.removeEventListener('devicemotion', this.handleDeviceMotion);
  }

  private startListening(): void {
    window.addEventListener('deviceorientation', this.handleOrientationChange);
    window.addEventListener('devicemotion', this.handleDeviceMotion);
    this.callbacks.onGravityChange(this.gravity);

    // Check after a short delay if we received any motion data
    this.motionCheckTimeout = window.setTimeout(() => {
      if (!this.hasReceivedMotionData) {
        // No motion data received - device doesn't have sensors
        this.callbacks.onStateChange('not-supported');
      }
    }, 500);
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

    // Mark that we received valid motion data
    if (!this.hasReceivedMotionData) {
      this.hasReceivedMotionData = true;
      if (this.motionCheckTimeout) {
        clearTimeout(this.motionCheckTimeout);
        this.motionCheckTimeout = null;
      }
    }

    const betaRad = (event.beta * Math.PI) / 180;
    const gammaRad = (event.gamma * Math.PI) / 180;
    const gx = Math.sin(gammaRad) * Math.cos(betaRad);
    const gy = -Math.sin(betaRad);

    this.normalizedDirection = {
      x: Math.max(-1, Math.min(1, gx)),
      y: Math.max(-1, Math.min(1, gy)),
    };

    this.gravity = {
      x: this.gravityMagnitude * this.normalizedDirection.x,
      y: this.gravityMagnitude * this.normalizedDirection.y,
    };

    this.callbacks.onGravityChange(this.gravity);
  };
}
