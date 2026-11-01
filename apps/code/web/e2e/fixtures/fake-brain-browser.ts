// Injected only by Playwright. The app uses the real Web Serial integration.
import { FakeBrain } from "../../tests/fake-brain"

const brain = new FakeBrain(40)
Object.defineProperty(navigator, "serial", {
  configurable: true,
  value: {
    requestPort: async () => brain,
    getPorts: async () => [],
    addEventListener() {},
    removeEventListener() {},
  },
})
