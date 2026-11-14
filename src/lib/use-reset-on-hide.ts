"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Réinitialise un état transitoire (fenêtre ouverte, données sensibles affichées)
 * lorsque la page est quittée. Next.js conserve l'état des pages masquées :
 * sans cela, une fenêtre de dialogue réapparaîtrait ouverte au retour sur la page.
 */
export function useResetOnHide(reset: () => void) {
  const latest = useRef(reset);
  useLayoutEffect(() => {
    latest.current = reset;
  });
  useLayoutEffect(() => () => latest.current(), []);
}
