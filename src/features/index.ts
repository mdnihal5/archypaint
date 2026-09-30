import { actions as calc } from "./calc";
import { actions as images } from "./images";
import { actions as present } from "./present";
import { actions as share } from "./share";
import { actions as textimport } from "./textimport";
import { actions as tidy } from "./tidy";
import type { Action } from "./types";

export type { Action, ActionSection, FeatureCtx } from "./types";

/** every contributed command, in menu order */
export const ACTIONS: readonly Action[] = [...tidy, ...calc, ...images, ...textimport, ...present, ...share];
