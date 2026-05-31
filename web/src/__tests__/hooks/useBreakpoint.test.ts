import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { calcBreakpointState } from "../../hooks/useBreakpoint.ts";
import { test } from "bun:test";


test("calcBreakpointState - classifies viewport widths correctly", () => {
  assertEquals(calcBreakpointState(375), {
    isMobile: true,
    isTablet: false,
    isDesktop: false,
    width: 375,
  });

  assertEquals(calcBreakpointState(768), {
    isMobile: false,
    isTablet: true,
    isDesktop: false,
    width: 768,
  });

  assertEquals(calcBreakpointState(1280), {
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    width: 1280,
  });
});
