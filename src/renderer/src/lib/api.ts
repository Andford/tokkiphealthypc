import type { TokkipAPI } from '../../../preload/index'

declare global {
  interface Window {
    tokkip: TokkipAPI
  }
}

export const api = window.tokkip
