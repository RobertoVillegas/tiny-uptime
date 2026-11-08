import { createCn } from "cn/config";
import { RADIUS, TEXT } from "./tokens";

/**
 * Joins class names and drops the ones a later class overrides. It is told about the token scale,
 * so `text-small` is read as a size, not a color, and survives next to `text-down`.
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: Object.keys(TEXT) }], rounded: [{ rounded: Object.keys(RADIUS) }] } },
});
