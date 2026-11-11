/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as canvases from "../canvases.js";
import type * as cards from "../cards.js";
import type * as connectors from "../connectors.js";
import type * as http from "../http.js";
import type * as links from "../links.js";
import type * as model_auth from "../model/auth.js";
import type * as model_canvas from "../model/canvas.js";
import type * as model_preview from "../model/preview.js";
import type * as search from "../search.js";
import type * as sharing from "../sharing.js";
import type * as storage from "../storage.js";
import type * as strokes from "../strokes.js";
import type * as validators from "../validators.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  canvases: typeof canvases;
  cards: typeof cards;
  connectors: typeof connectors;
  http: typeof http;
  links: typeof links;
  "model/auth": typeof model_auth;
  "model/canvas": typeof model_canvas;
  "model/preview": typeof model_preview;
  search: typeof search;
  sharing: typeof sharing;
  storage: typeof storage;
  strokes: typeof strokes;
  validators: typeof validators;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
