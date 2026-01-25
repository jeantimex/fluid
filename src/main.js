import './style.css'
import GUI from 'lil-gui'
import Stats from 'stats-gl'
import { createSim } from './sim.js'

document.querySelector('#app').innerHTML = `
  <canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>
`

const canvas = document.querySelector('#sim-canvas')
const sim = createSim(canvas)
const gui = new GUI({ title: 'Simulation Settings' })
const stats = new Stats({ trackGPU: false, horizontal: true })
document.body.appendChild(stats.dom)
const uiState = { showStats: true }

const spawnDensityCtrl = gui
  .add(sim.config, 'spawnDensity', 10, 300, 1)
  .name('Spawn Density')
  .onFinishChange(() => sim.reset())
gui.add(sim.config, 'gravity', -30, 30, 0.1).name('Gravity')
gui.add(sim.config, 'collisionDamping', 0, 1, 0.01).name('Collision Damping')
const smoothingCtrl = gui
  .add(sim.config, 'smoothingRadius', 0.05, 3, 0.01)
  .name('Smoothing Radius')
  .onChange(sim.refreshSettings)
const targetDensityCtrl = gui
  .add(sim.config, 'targetDensity', 0, 3000, 1)
  .name('Target Density')
const pressureCtrl = gui
  .add(sim.config, 'pressureMultiplier', 0, 2000, 1)
  .name('Pressure Multiplier')
const nearPressureCtrl = gui
  .add(sim.config, 'nearPressureMultiplier', 0, 40, 0.1)
  .name('Near Pressure Multiplier')
const viscosityCtrl = gui
  .add(sim.config, 'viscosityStrength', 0, 0.2, 0.001)
  .name('Viscosity Strength')
const particleRadiusCtrl = gui
  .add(sim.config, 'particleRadius', 1, 6, 1)
  .name('Particle Radius')
particleRadiusCtrl.onChange(() => {
  sim.applyParticleScale()
  smoothingCtrl.updateDisplay()
  targetDensityCtrl.updateDisplay()
  pressureCtrl.updateDisplay()
  nearPressureCtrl.updateDisplay()
  viscosityCtrl.updateDisplay()
})
gui.add(sim.config, 'timeScale', 0, 2, 0.01).name('Time Scale')
gui.add(sim.config, 'maxTimestepFPS', 0, 120, 1).name('Max Timestep FPS')
gui
  .add(sim.config, 'iterationsPerFrame', 1, 8, 1)
  .name('Iterations Per Frame')
gui
  .add(uiState, 'showStats')
  .name('Show FPS')
  .onChange((value) => {
    stats.dom.style.display = value ? 'block' : 'none'
  })

let lastTime = performance.now()

function frame(now) {
  stats.begin()
  const dt = Math.min(0.033, (now - lastTime) / 1000)
  lastTime = now
  sim.step(dt)
  sim.draw()
  stats.end()
  stats.update()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
