// Input preference only: movement remains physics/root-motion driven.
export function shouldSprint(keys,autoSprint,moving){
  return !!(keys?.ShiftLeft || keys?.ShiftRight || (autoSprint && moving));
}
