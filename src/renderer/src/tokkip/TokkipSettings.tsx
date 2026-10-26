// Preferences → Tokkip: his species and colour (shared with Tokkip PC's look
// key), and his sounds.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tokkip } from './Tokkip'
import { DEFAULT_LOOK, SPECIES, loadLook, onLookChange, saveLook, type TokkipLook } from './art'
import { play, setSoundsOn, soundsOn } from './sound'
import { clipFor } from './shapes'

const BODIES = [
  '#F7EAD3',
  '#F5F6F8',
  '#C4B5FD',
  '#86EFAC',
  '#FBCFE8',
  '#FDE68A',
  '#BAE6FD',
  '#D6D3D1'
]

export function TokkipSettings() {
  const { t } = useTranslation('tokkip')
  const [look, setLook] = useState<TokkipLook>(loadLook())
  const [sounds, setSounds] = useState(soundsOn())
  const [hop, setHop] = useState(0)
  useEffect(() => onLookChange(setLook), [])
  const change = (next: Partial<TokkipLook>) => {
    const l = { ...look, ...next }
    saveLook(l)
    setLook(l)
    setHop((h) => h + 1)
  }
  return (
    <div className="tokkip-settings">
      <div className="tokkip-settings-top">
        <Tokkip mood="happy" size={110} jump={hop} />
        <p>{t('settings.intro')}</p>
      </div>
      <div className="tokkip-settings-row">
        <span>{t('settings.species')}</span>
        <div className="tokkip-pills">
          {SPECIES.map((s) => (
            <button
              key={s.id}
              aria-pressed={look.species === s.id}
              onClick={() => change({ species: s.id })}
            >
              {t(`settings.speciesNames.${s.id}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="tokkip-settings-row">
        <span>{t('settings.color')}</span>
        <div className="tokkip-swatches">
          {BODIES.map((c) => (
            <button
              key={c}
              aria-label={c}
              aria-pressed={look.body.toLowerCase() === c.toLowerCase()}
              style={{
                background: c,
                clipPath: clipFor(
                  look.body.toLowerCase() === c.toLowerCase() ? 'cookie9' : 'circle'
                )
              }}
              onClick={() => change({ body: c, accent: look.accent || DEFAULT_LOOK.accent })}
            />
          ))}
        </div>
      </div>
      <label className="tokkip-settings-row">
        <span>
          {t('settings.sounds')}
          <small>{t('settings.soundsDesc')}</small>
        </span>
        <input
          type="checkbox"
          checked={sounds}
          onChange={(e) => {
            setSoundsOn(e.target.checked)
            setSounds(e.target.checked)
            if (e.target.checked) play('pop')
          }}
        />
      </label>
      <p className="tokkip-settings-note">
        <strong>{t('settings.island')}</strong> · {t('settings.islandDesc')}
      </p>
    </div>
  )
}
