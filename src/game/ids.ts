// Incidents, pins, planned changes, alerts, automation rules and inquiries all draw ids from one run counter
// (RunState.nextId); a prefix per kind keeps pin 12 from reading like incident 13 (playtest round 2, finding K).
export const ID_PREFIX = { incident: 'INC', pin: 'PIN', change: 'CHG', alert: 'ALR', automation: 'AUT', inquiry: 'INQ' } as const;
export type IdKind = keyof typeof ID_PREFIX;

export const idText = (kind: IdKind, id: number): string => `${ID_PREFIX[kind]}${id}`;

const article = (word: string): string => (/^[aeiou]/.test(word) ? 'an' : 'a');

/** Reads "INC13", "inc13", "#13" or "13" as 13. Throws on junk or on another kind's prefix, naming the kind it wants. */
export function parseIdText(kind: IdKind, text: string): number {
  const m = /^([A-Za-z]*|#)(\d+)$/.exec(text.trim());
  const prefix = m?.[1]?.toUpperCase() ?? '';
  if (m && (prefix === '' || prefix === '#' || prefix === ID_PREFIX[kind])) return Number(m[2]);
  const other = (Object.keys(ID_PREFIX) as IdKind[]).find((k) => ID_PREFIX[k] === prefix);
  throw new Error(`${text} is ${other ? `${article(other)} ${other} id` : 'not an id'}; expected ${article(kind)} ${kind} id like ${idText(kind, 12)}`);
}
