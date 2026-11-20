"use client";

// The Run page switches (migration 070) for the team screens' client components: the team layout puts event_status's
// switch map here, and a component asks for one switch. Outside the team layout (or on a database older than 070)
// every switch reads as its fallback, which is today's behaviour.

import { createContext, useContext, type ReactNode } from "react";

const FeaturesContext = createContext<Readonly<Record<string, boolean>>>({});

export function TeamFeatures({ features, children }: { features: Readonly<Record<string, boolean>> | undefined; children: ReactNode }) {
  return <FeaturesContext.Provider value={features ?? {}}>{children}</FeaturesContext.Provider>;
}

/** Is this switch on? `fallback` when the map does not say. */
export function useFeature(key: string, fallback = false): boolean {
  const v = useContext(FeaturesContext)[key];
  return typeof v === "boolean" ? v : fallback;
}
