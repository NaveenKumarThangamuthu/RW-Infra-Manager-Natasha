import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `color-mix` tint used across the design for status pills and icon wells. */
export function tint(color: string, percent = 14): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}
