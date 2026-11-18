// The seed field shared by the new-run form and the first-day difficulty picker. Split from `Overlays.tsx` (CL-38).


/** A seed typed by the player (to replay a run or share one), else a random one. */
export const seedOr = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Math.floor(Math.random() * 1e6));

export function SeedInput({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <label title="Leave empty for a random seed; the same seed, scenario and difficulty give the same run">
      Seed{' '}
      <input inputMode="numeric" pattern="[0-9]*" size={8} placeholder="random" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
    </label>
  );
}
