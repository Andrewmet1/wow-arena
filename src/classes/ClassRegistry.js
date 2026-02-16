import { tyrantClass } from './Tyrant.js';
import WraithClass from './Wraith.js';
import { InfernalClass } from './Infernal.js';
import { HarbingerClass } from './Harbinger.js';
import { RevenantClass } from './Revenant.js';

export const CLASS_REGISTRY = {
  tyrant: tyrantClass,
  wraith: WraithClass,
  infernal: InfernalClass,
  harbinger: HarbingerClass,
  revenant: RevenantClass
};

export const ALL_CLASSES = Object.values(CLASS_REGISTRY);
export const CLASS_IDS = Object.keys(CLASS_REGISTRY);

export function getClass(classId) {
  return CLASS_REGISTRY[classId] || null;
}
