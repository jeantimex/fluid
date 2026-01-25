import './style.css'
import { createSim } from './sim.js'

document.querySelector('#app').innerHTML = `
  <canvas id="sim-canvas" width="900" height="600" aria-label="Fluid simulation"></canvas>
`

const canvas = document.querySelector('#sim-canvas')
const sim = createSim(canvas)

let lastTime = performance.now()

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000)
  lastTime = now
  sim.step(dt)
  sim.draw()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
