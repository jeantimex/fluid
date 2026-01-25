import './style.css'
import GUI from 'lil-gui'
import { createSim } from './sim.js'

document.querySelector('#app').innerHTML = `
  <canvas id="sim-canvas" width="900" height="600" aria-label="Fluid simulation"></canvas>
`

const canvas = document.querySelector('#sim-canvas')
const sim = createSim(canvas)
const gui = new GUI({ title: 'Simulation Settings' })

gui.add(sim.config, 'timeScale', 0, 2, 0.01)
gui.add(sim.config, 'maxTimestepFPS', 0, 120, 1)
gui.add(sim.config, 'iterationsPerFrame', 1, 8, 1)
gui.add(sim.config, 'gravity', -30, 30, 0.1)
gui.add(sim.config, 'collisionDamping', 0, 1, 0.01)
gui
  .add(sim.config, 'smoothingRadius', 0.05, 1, 0.01)
  .onChange(sim.refreshSettings)
gui.add(sim.config, 'targetDensity', 0, 100, 1)
gui.add(sim.config, 'pressureMultiplier', 0, 1000, 1)
gui.add(sim.config, 'nearPressureMultiplier', 0, 20, 0.1)
gui.add(sim.config, 'viscosityStrength', 0, 0.2, 0.001)
gui
  .add(sim.config, 'spawnDensity', 10, 300, 1)
  .onFinishChange(() => sim.reset())

let lastTime = performance.now()

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000)
  lastTime = now
  sim.step(dt)
  sim.draw()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
