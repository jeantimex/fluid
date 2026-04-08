<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let gravityX: number = $state(0);
	let gravityY: number = $state(0);
	let hasReceivedData: boolean = $state(false);
	let permission: string = $state('unknown');

	const requestPermission = async () => {
		if (!browser) return;

		if (
			'DeviceOrientationEvent' in window &&
			typeof (DeviceOrientationEvent as any).requestPermission === 'function'
		) {
			try {
				const response = await (DeviceOrientationEvent as any).requestPermission();
				permission = response;
				if (response === 'granted') {
					startListening();
				}
			} catch (error) {
				console.error('Error requesting device orientation permission:', error);
				permission = 'denied';
			}
		} else if ('DeviceOrientationEvent' in window) {
			permission = 'granted';
			startListening();
		} else {
			permission = 'not-supported';
		}
	};

	const startListening = () => {
		if (!browser) return;
		window.addEventListener('deviceorientation', onOrientationChange);
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
			const gy = sinBeta;

			gravityX = Math.max(-1, Math.min(1, gx));
			gravityY = Math.max(-1, Math.min(1, gy));

			if (!hasReceivedData) {
				hasReceivedData = true;
			}
		}
	};

	onMount(() => {
		if (browser) {
			if (
				!(
					'DeviceOrientationEvent' in window &&
					typeof (DeviceOrientationEvent as any).requestPermission === 'function'
				)
			) {
				requestPermission();
			}
		}
	});

	onDestroy(() => {
		if (browser && window) {
			window.removeEventListener('deviceorientation', onOrientationChange);
		}
	});

	const xBarStyle = $derived.by(() => {
		const width = Math.abs(gravityX) * 50;
		if (gravityX > 0) {
			return `left: 50%; width: ${width}%;`;
		}
		return `right: 50%; width: ${width}%;`;
	});

	const yBarStyle = $derived.by(() => {
		const height = Math.abs(gravityY) * 50;
		if (gravityY > 0) {
			return `top: 50%; height: ${height}%;`;
		}
		return `bottom: 50%; height: ${height}%;`;
	});
</script>

<div class="flex h-screen flex-col items-center justify-center bg-slate-800 text-white">
	{#if permission === 'unknown'}
		<div class="text-center">
			<h1 class="mb-4 text-2xl font-bold">Gravity Vectors</h1>
			<p class="mb-6 max-w-sm">
				This demo needs access to your device's orientation sensors to work.
			</p>
			<button
				onclick={requestPermission}
				class="rounded-lg bg-blue-500 px-6 py-3 font-semibold text-white shadow-lg hover:bg-blue-600"
			>
				Enable Device Orientation
			</button>
		</div>
	{:else if permission === 'denied'}
		<p class="max-w-sm text-center text-xl">
			Permission denied. Please enable Motion & Orientation Access for this site in your browser
			settings.
		</p>
	{:else if permission === 'not-supported'}
		<p class="text-center text-xl">Device orientation not supported on this device.</p>
	{:else if !hasReceivedData}
		<p>Waiting for orientation data...</p>
	{:else}
		<div
			class="relative mb-8 h-64 w-64 rounded-lg border-2 border-slate-500 bg-slate-900/50 shadow-lg"
		>
			<!-- Center Axis Lines -->
			<div
				class="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-slate-600"
				aria-hidden="true"
			></div>
			<div
				class="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-slate-600"
				aria-hidden="true"
			></div>

			<!-- Gravity Y Vector (Vertical Bar) -->
			<div
				class="absolute left-1/2 w-4 -translate-x-1/2 rounded-full bg-blue-400/80 transition-[height]"
				style={yBarStyle}
			></div>

			<!-- Gravity X Vector (Horizontal Bar) -->
			<div
				class="absolute top-1/2 h-4 -translate-y-1/2 rounded-full bg-red-400/80 transition-[width]"
				style={xBarStyle}
			></div>

			<!-- Labels -->
			<span class="absolute top-1 right-2 text-xs text-red-400">gX</span>
			<span class="absolute top-2 left-1 text-xs text-blue-400">gY</span>
		</div>

		<div class="absolute bottom-10 text-center font-mono">
			<p>Gravity X: <span class="font-bold text-red-400">{gravityX.toFixed(3)}</span></p>
			<p>Gravity Y: <span class="font-bold text-blue-400">{gravityY.toFixed(3)}</span></p>
		</div>
	{/if}
</div>
