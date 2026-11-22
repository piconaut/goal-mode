// Pager chime on each new incident and a faint tick each sim hour. Split from `App.tsx` (CL-38).

import { useEffect, useRef } from 'react';
import type { ViewModel } from '../../game/view';
import { hourTick, pagerChime } from '../sound';
import { useStored } from '../useStored';

/** Pager chime on each new incident and a faint tick each sim hour; off until the player turns it on. */
export function SoundToggle({ v }: { v: ViewModel }) {
  const [sound, setSound] = useStored<'on' | 'off'>('goalmode.sound', 'off');
  const lastIncident = useRef<number | null>(null);
  const lastHour = useRef<number | null>(null);
  const newestId = v.incidents.at(-1)?.id ?? 0;
  const hour = Math.floor((v.day * v.ticksPerDay + v.tickOfDay) / 360);
  useEffect(() => {
    if (sound === 'on' && lastIncident.current !== null && newestId > lastIncident.current) pagerChime();
    lastIncident.current = newestId;
  }, [newestId, sound]);
  useEffect(() => {
    if (sound === 'on' && v.phase === 'LIVE' && lastHour.current !== null && hour !== lastHour.current) hourTick();
    lastHour.current = hour;
  }, [hour, sound, v.phase]);
  return (
    <button style={{ marginLeft: 'auto' }} aria-pressed={sound === 'on'} title="Pager chime on incidents, tick each hour" onClick={() => setSound(sound === 'on' ? 'off' : 'on')}>
      {sound === 'on' ? '🔔 sound' : '🔕 muted'}
    </button>
  );
}
