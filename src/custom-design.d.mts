import type { Spec, CustomBrick } from './engine';
export const CUSTOM_DESIGN_PROMPT: string;
export function validateCustomSpec(value: unknown): Spec;
export function expandCustomBricks(records: CustomBrick[]): CustomBrick[];
