// Every task kind's behaviour tree, in one table (kept apart from trees.ts so the medication and
// fall trees can use the shared tree helpers without an import cycle at load time).

import type { BtNode } from "./bt.js";
import { fallTree } from "./falls.js";
import { medRoundTree } from "./meds.js";
import { letInTree } from "./visitors.js";
import type { TaskKind } from "./state.js";
import { assistTree, breakTree, briefingTree, careTree, handoverTree, roundTree, selfToiletTree, type Ctx } from "./trees.js";

export const TREES: Record<TaskKind, BtNode<Ctx>> = {
  assist: assistTree,
  self_toilet: selfToiletTree,
  care: careTree,
  round: roundTree,
  handover: handoverTree,
  briefing: briefingTree,
  break: breakTree,
  med_round: medRoundTree,
  fall: fallTree,
  let_in: letInTree,
};
