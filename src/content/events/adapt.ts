import { MIDWEST_EVENTS, type EventDef } from './midwest-events';

const midwestCard = (id: string): EventDef => {
  const c = MIDWEST_EVENTS.find((e) => e.id === id);
  if (!c) throw new Error(`No Midwest card ${id}`);
  return c;
};

/** Clone a Midwest card with overrides, retargeting workload ids in its begin/end commands (and affects). */
export function adapt(id: string, overrides: Partial<EventDef>, retarget: Record<string, string> = {}): EventDef {
  let json = JSON.stringify(midwestCard(id));
  for (const [from, to] of Object.entries(retarget)) json = json.split(`"${from}"`).join(`"${to}"`);
  return { ...(JSON.parse(json) as EventDef), ...overrides };
}

