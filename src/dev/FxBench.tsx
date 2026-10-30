// Dev only, at #/fx-bench: a lower third with every light effect, full screen and on air as an output draws it, for
// scripts/fx-bench.ts to measure. #/fx-bench?off draws the same design with no effects, as the baseline.
import { useEffect } from 'react'
import { newEffect } from '../../shared/designEffects'
import { EMPTY_DESIGN, rectElement, textElement } from '../../shared/designs'
import type { DesignStyle } from '../../shared/types'
import { DesignView } from '../components/DesignView'
import { effectClockStats } from '../lib/effectClock'

const off = window.location.hash.includes('off')
const fx = <T extends Parameters<typeof newEffect>[0]>(kind: T, id: string) => (off ? [] : [newEffect(kind, id)])

const DESIGN: DesignStyle = {
  ...EMPTY_DESIGN.lowerThird,
  elements: [
    rectElement('bar', 'Name bar', { x: 5, y: 72, width: 48, height: 12 }, { radius: 1.2, effects: [...fx('lightSweep', 'sweep'), ...fx('borderChase', 'chase'), ...fx('glowPulse', 'glow')] }),
    rectElement('storm', 'Storm', { x: 60, y: 8, width: 32, height: 22 }, { radius: 2, fill: { kind: 'solid', color: '#0b1f44' }, effects: fx('lightning', 'bolt') }),
    textElement('name', 'Name', { x: 7, y: 73.5, width: 44, height: 6 }, { text: 'Pastor Sam Example', fontSize: 4.5, effects: [...fx('scanLine', 'scan'), ...fx('flicker', 'flicker')] }),
    textElement('role', 'Role', { x: 7, y: 79.5, width: 44, height: 4 }, { text: 'Lead Pastor', fontSize: 2.6 }),
  ],
}

export default function FxBench() {
  useEffect(() => {
    Object.assign(window, { __fxStats: effectClockStats })
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', containerType: 'size' }}>
      <DesignView style={DESIGN} onAir />
    </div>
  )
}
