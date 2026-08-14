import type { HarnessDeskApi } from '../shared/contracts.js'

declare global {
  interface Window {
    harnessdesk: HarnessDeskApi
  }
}

export {}
