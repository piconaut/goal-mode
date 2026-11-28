// Labels the player sees for sim values that appear in more than one place (the Change Desk and the report card).
import type { GatewayMode } from '../sim/core/operations';

export const GATEWAY_MODE_LABEL: Readonly<Record<GatewayMode, string>> = {
  LIMIT: 'Rate limit',
  BACKOFF: 'Client backoff',
  BLOCK: 'Block source addresses',
};
