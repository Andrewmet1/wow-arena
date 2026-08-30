// GENERATED from prompt: "an overgrown forest temple swallowed by roots and moss, shafts of green light"
// Edit freely — this is the source of truth for the biome, not a cache.
import { piece } from '../../src/rendering/env/KitSchema.js';

export default {
  id: "overgrown_forest_temple",
  name: "Overgrown Forest Temple",
  prompt: "an overgrown forest temple swallowed by roots and moss, shafts of green light",
  grid: {"cell":4,"wallHeight":6},
  atmosphere: {
    "ambientColor": 4045925,
    "ambientIntensity": 0.3,
    "fogColor": 3568575,
    "fogDensity": 0.02,
    "keyColor": 16769280,
    "keyIntensity": 1.1,
    "groundTint": 4488307,
    "bloomStrength": 0.85
  },
  kit: [
    piece({
      "variants": [
        "mossy_stone_floor_v1",
        "mossy_stone_floor_v2"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 0.1,
      "tags": [],
      "id": "mossy_stone_floor",
      "role": "floor",
      "prompt": "A single square of moss-covered stone floor with small vines creeping over its surface. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "weathered_stone_wall_v1",
        "weathered_stone_wall_v2"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 6,
      "tags": [],
      "id": "weathered_stone_wall",
      "role": "wall",
      "prompt": "A vertical slice of weathered stone wall with patches of green moss and occasional roots. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "mossy_corner_v1"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 6,
      "tags": [],
      "id": "mossy_corner",
      "role": "corner",
      "prompt": "A corner piece of a stone wall, covered in moss with two finished stone faces meeting at a right angle. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "root_doorway_v1"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 6,
      "tags": [],
      "id": "root_doorway",
      "role": "doorway",
      "prompt": "An archway made of entwined roots forming a natural doorway, partially covered with moss. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "stone_pillar_v1"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 6,
      "tags": [],
      "id": "stone_pillar",
      "role": "pillar",
      "prompt": "A round stone pillar wrapped with creeping vines and spots of moss, standing tall. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "root_stair_v1"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 0.5,
      "tags": [],
      "id": "root_stair",
      "role": "stair",
      "prompt": "A short set of stone steps partially engulfed by roots and moss. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "root_trim_v1"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 0.2,
      "tags": [],
      "id": "root_trim",
      "role": "trim",
      "prompt": "A strip of dense roots and moss, used as trim along walls or floors. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
    piece({
      "variants": [
        "moss_filler_v1"
      ],
      "footprint": [
        1,
        1
      ],
      "height": 0.1,
      "tags": [],
      "id": "moss_filler",
      "role": "filler",
      "prompt": "A patch of thick moss, used to fill gaps between stones. PBR game asset, neutral even lighting, no baked shadows, isolated on transparent background."
    }),
  ],
  rules: {
    "fillerRate": 0.1,
    "pillarRate": 0.05,
    "trim": true,
    "variantJitter": true
  },
};
