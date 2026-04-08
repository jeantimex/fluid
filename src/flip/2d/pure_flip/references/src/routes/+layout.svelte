<script lang="ts">
	import '../app.css';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';

	injectAnalytics();

	let { children } = $props();
</script>

<svelte:head>
	<title>FLIP Fluid Simulator for Mobile | Gyro-Based Fluid Simulation</title>

	<meta
		name="description"
		content="A mobile-friendly FLIP fluid simulator that reacts to device orientation and tilt."
	/>

	<meta
		name="keywords"
		content="FLIP fluid simulator, mobile fluid simulation, phone tilt simulation, gyroscope fluid dynamics, orientation-based fluid sim, real-time physics, interactive fluids, WebGL fluid simulator, phone gyroscope experiments, fluid dynamics demo"
	/>

	<meta name="author" content="Shajid Hasan" />

	<meta property="og:title" content="FLIP Fluid Simulator for Mobile" />
	<meta
		property="og:description"
		content="An interactive FLIP fluid simulator for phones that responds to orientation and tilt."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://fluid.sh4jid.me" />
	<meta property="og:image" content="/mobile-fluid-sim.png" />
</svelte:head>

{@render children?.()}
