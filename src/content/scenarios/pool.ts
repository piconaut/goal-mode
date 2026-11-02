import type { LparPoolConfig } from '../../sim/core/types';

export const pool = (pool: LparPoolConfig['pool'], logical: number, weight: number, extra: Partial<LparPoolConfig> = {}): LparPoolConfig => ({
  pool,
  logical,
  reserved: 0,
  weight,
  dedicated: false,
  initialCapping: false,
  absoluteCapEngines: null,
  ...extra,
});

