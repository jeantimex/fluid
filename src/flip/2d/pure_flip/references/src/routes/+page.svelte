<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Smartphone from '@lucide/svelte/icons/smartphone';

	import { onMount, onDestroy } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	import { browser } from '$app/environment';
	import FluidSimulation from '$lib/FluidSimulation.svelte';
	import GitHubLink from '$lib/GitHubLink.svelte';
	import PopupInfo from '$lib/PopupInfo.svelte';

	const MAX_GRAVITY = 9.81;

	type AppState = 'loading' | 'needs-permission' | 'ready' | 'denied' | 'not-supported';

	const fluidTypes = [
		{
			fluidColor: { r: 0.09, g: 0.4, b: 1.0 },
			foamColor: { r: 0.75, g: 0.9, b: 1.0 },
			colorDiffusionCoeff: 0.0008,
			foamReturnRate: 0.5
		},
		{
			fluidColor: { r: 0.0, g: 0.7, b: 0.8 },
			foamColor: { r: 0.6, g: 0.95, b: 0.9 },
			colorDiffusionCoeff: 0.0012,
			foamReturnRate: 0.6
		},
		{
			fluidColor: { r: 1.0, g: 0.4, b: 0.1 },
			foamColor: { r: 1.0, g: 0.8, b: 0.6 },
			colorDiffusionCoeff: 0.0004,
			foamReturnRate: 0.3
		},
		{
			fluidColor: { r: 0.5, g: 0.2, b: 0.9 },
			foamColor: { r: 0.8, g: 0.7, b: 1.0 },
			colorDiffusionCoeff: 0.001,
			foamReturnRate: 0.7
		},
		{
			fluidColor: { r: 0.1, g: 0.6, b: 0.4 },
			foamColor: { r: 0.7, g: 0.95, b: 0.8 },
			colorDiffusionCoeff: 0.0015,
			foamReturnRate: 0.4
		},
		{
			fluidColor: { r: 0.9, g: 0.5, b: 0.6 },
			foamColor: { r: 1.0, g: 0.85, b: 0.9 },
			colorDiffusionCoeff: 0.0006,
			foamReturnRate: 0.8
		},
		{
			fluidColor: { r: 0.3, g: 0.7, b: 0.9 },
			foamColor: { r: 0.9, g: 0.95, b: 1.0 },
			colorDiffusionCoeff: 0.0009,
			foamReturnRate: 0.5
		},
		{
			fluidColor: { r: 0.9, g: 0.7, b: 0.2 },
			foamColor: { r: 1.0, g: 0.9, b: 0.7 },
			colorDiffusionCoeff: 0.0005,
			foamReturnRate: 0.2
		}
	];

	let currentFluidIndex = $state(0);

	let angle: number | undefined = $state(0);
	let gravity: { x: number; y: number } = $state({ x: 0, y: -MAX_GRAVITY });
	let fluidColor = new Tween(fluidTypes[0].fluidColor, {
		duration: 500,
		easing: cubicOut
	});
	let foamColor = new Tween(fluidTypes[0].foamColor, {
		duration: 500,
		easing: cubicOut
	});
	let colorDiffusionCoeff: number = $state(fluidTypes[0].colorDiffusionCoeff);
	let foamReturnRate: number = $state(fluidTypes[0].foamReturnRate);

	let appState: AppState = $state('loading');

	// Shake detection
	let lastShakeTime = 0;
	let lastAcceleration = { x: 0, y: 0, z: 0 };
	let shakeThreshold = 15;
	let shakeTimeThreshold = 600;

	const requestPermission = async () => {
		if (!browser) return;

		if (
			'DeviceOrientationEvent' in window &&
			typeof (DeviceOrientationEvent as any).requestPermission === 'function'
		) {
			// iOS 13+ permission request
			try {
				const orientationResponse = await (DeviceOrientationEvent as any).requestPermission();
				let motionResponse = 'granted';

				// Also request motion permission if available
				if (
					'DeviceMotionEvent' in window &&
					typeof (DeviceMotionEvent as any).requestPermission === 'function'
				) {
					motionResponse = await (DeviceMotionEvent as any).requestPermission();
				}

				if (orientationResponse === 'granted' && motionResponse === 'granted') {
					startListening();
					appState = 'ready';
				} else {
					appState = 'denied';
				}
			} catch (error) {
				console.error('Error requesting device motion/orientation permission:', error);
				appState = 'denied';
			}
		} else if ('DeviceOrientationEvent' in window) {
			startListening();
			appState = 'ready';
		} else {
			appState = 'not-supported';
		}
	};

	const startListening = () => {
		if (!browser) return;
		window.addEventListener('deviceorientation', onOrientationChange);
		window.addEventListener('devicemotion', onDeviceMotion);
	};

	const onDeviceMotion = (event: DeviceMotionEvent) => {
		if (!event.accelerationIncludingGravity) return;

		const acceleration = event.accelerationIncludingGravity;
		const x = acceleration.x || 0;
		const y = acceleration.y || 0;
		const z = acceleration.z || 0;

		// Calculate the magnitude of acceleration change
		const deltaX = Math.abs(x - lastAcceleration.x);
		const deltaY = Math.abs(y - lastAcceleration.y);
		const deltaZ = Math.abs(z - lastAcceleration.z);

		const totalDelta = deltaX + deltaY + deltaZ;
		const currentTime = Date.now();

		// Check if shake threshold is exceeded and enough time has passed
		if (totalDelta > shakeThreshold && currentTime - lastShakeTime > shakeTimeThreshold) {
			onShake();
			lastShakeTime = currentTime;
		}

		// Update last acceleration values
		lastAcceleration = { x, y, z };
	};

	const onOrientationChange = (event: DeviceOrientationEvent) => {
		if (event.beta !== null && event.gamma !== null) {
			const beta = event.beta;
			const gamma = event.gamma;

			const betaRad = beta * (Math.PI / 180);
			const gammaRad = gamma * (Math.PI / 180);

			const cosBeta = Math.cos(betaRad);
			const sinBeta = Math.sin(betaRad);
			const sinGamma = Math.sin(gammaRad);

			const gx = sinGamma * cosBeta;
			const gy = -sinBeta;

			gravity.x = MAX_GRAVITY * Math.max(-1, Math.min(1, gx));
			gravity.y = MAX_GRAVITY * Math.max(-1, Math.min(1, gy));
		}
	};

	onMount(async () => {
		if (!browser) return;

		if (!('DeviceOrientationEvent' in window)) {
			gravity = { x: 0, y: -MAX_GRAVITY };
			angle = 0;
			appState = 'not-supported';
			return;
		}

		if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
			appState = 'needs-permission';
		} else {
			startListening();
			appState = 'ready';
		}
	});

	onDestroy(() => {
		if (browser && window) {
			window.removeEventListener('deviceorientation', onOrientationChange);
			window.removeEventListener('devicemotion', onDeviceMotion);
		}
	});

	const onShake = () => {
		currentFluidIndex = (currentFluidIndex + 1) % fluidTypes.length;
		const newFluid = fluidTypes[currentFluidIndex];

		// Tween only the colors
		fluidColor.target = newFluid.fluidColor;
		foamColor.target = newFluid.foamColor;

		// Update other properties immediately
		colorDiffusionCoeff = newFluid.colorDiffusionCoeff;
		foamReturnRate = newFluid.foamReturnRate;
	};
</script>

<div
	class="relative flex h-screen flex-col items-center justify-center bg-gradient-to-b from-gray-900 via-gray-800 to-gray-950"
>
	<GitHubLink />
	{#if appState === 'loading'}
		<div class="text-center">
			<Loader2 class="mx-auto mb-4 h-12 w-12 animate-spin text-blue-400" />
			<h1 class="mb-2 text-2xl font-bold text-white">Fluid Simulation</h1>
			<p class="text-gray-300">Initializing...</p>
		</div>
	{:else if appState === 'needs-permission'}
		<div class="text-center">
			<Smartphone class="mx-auto mb-6 h-16 w-16 text-blue-400" />
			<h1 class="mb-4 text-2xl font-bold text-white">Motion Sensors Required</h1>
			<p class="mb-6 max-w-sm text-gray-300">
				This fluid simulation responds to your device's tilt and orientation. It also detects shake
				gestures to change fluid colors! Please grant permission to access motion sensors for the
				best experience.
			</p>
			<button
				onclick={requestPermission}
				class="rounded-lg bg-blue-500 px-8 py-3 font-semibold text-white shadow-lg transition-colors hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 focus:outline-none"
			>
				Enable Motion Sensors
			</button>
		</div>
	{:else if appState === 'denied'}
		<div class="text-center">
			<div class="mb-6 text-6xl">🚫</div>
			<h2 class="mb-4 text-xl font-semibold text-white">Permission Denied</h2>
			<p class="max-w-sm text-center text-gray-300">
				Motion sensor access was denied. You can still use the simulation, but it won't respond to
				device tilt. To enable this feature, please allow motion access in your browser settings.
			</p>
			<button
				onclick={requestPermission}
				class="mt-4 rounded-lg bg-gray-600 px-6 py-2 text-white transition-colors hover:bg-gray-500"
			>
				Try Again
			</button>
		</div>
	{:else}
		<FluidSimulation
			{gravity}
			fluidColor={fluidColor.current}
			foamColor={foamColor.current}
			{colorDiffusionCoeff}
			{foamReturnRate}
		/>

		{#if appState === 'ready'}
			<PopupInfo />
		{/if}
	{/if}
</div>
