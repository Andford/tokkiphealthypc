// Tokkip's sounds (synthesised for Tokkip, see Andford/tokkip android/tools/
// make_sounds.py): a pop, a check, a hello and the level-up jingle. Off in
// Preferences → Tokkip.

import pop from '@/assets/sounds/pop.wav'
import taskDone from '@/assets/sounds/task_done.wav'
import greet from '@/assets/sounds/greet.wav'
import levelUp from '@/assets/sounds/level_up.wav'

const FILES = { pop, task_done: taskDone, greet, level_up: levelUp }
export type TokkipSound = keyof typeof FILES

const KEY = 'tokkip.sounds'

export function soundsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundsOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* not kept */
  }
}

export function play(name: TokkipSound, volume = 0.7) {
  if (!soundsOn()) return
  try {
    const a = new Audio(FILES[name])
    a.volume = volume
    void a.play().catch(() => {})
  } catch {
    /* no audio: fine */
  }
}
