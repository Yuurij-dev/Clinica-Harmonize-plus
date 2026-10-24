"use client";

import { useLayoutEffect, useRef, type HTMLAttributes } from "react";

const MAX_STAGGER_INDEX = 6;

type AnimatedPageProps = HTMLAttributes<HTMLDivElement> & {
  /** Muda quando a seção/aba troca: o conteúdo é remontado e a entrada em cascata roda de novo. */
  routeKey: string;
  /** Não anima na primeira montagem (uso aninhado, quando um pai já anima a entrada). */
  skipInitial?: boolean;
};

function isRevealable(element: Element) {
  if (!(element instanceof HTMLElement) || element.hasAttribute("data-hp-no-reveal") || element.hidden) return false;
  return getComputedStyle(element).display !== "none";
}

/**
 * Anima a ENTRADA do conteúdo: título (fade + blur + translateY) e depois cards em cascata.
 * Não toca nas telas: usa [data-hp-title] / [data-hp-reveal] / [data-hp-reveal-group] quando existirem;
 * sem marcação, usa os filhos diretos do bloco raiz. A animação é só CSS (globals.css, [data-hp-reveal-item]).
 * A saída não é animada: exigiria manter a seção antiga montada (efeitos/requisições duplicados e atraso na navegação).
 */
export function AnimatedPage({ routeKey, skipInitial = false, children, ...props }: AnimatedPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  useLayoutEffect(() => {
    const isFirst = firstRun.current;
    firstRun.current = false;
    const root = rootRef.current;
    if (!root || (isFirst && skipInitial)) return;

    const items: HTMLElement[] = [];
    const title = root.querySelector<HTMLElement>("[data-hp-title]");
    const explicit = Array.from(root.querySelectorAll<HTMLElement>("[data-hp-reveal]"));
    const groups = Array.from(root.querySelectorAll<HTMLElement>("[data-hp-reveal-group]"));

    if (explicit.length || groups.length) {
      explicit.forEach((element) => items.push(element));
      groups.forEach((group) => Array.from(group.children).forEach((child) => child instanceof HTMLElement && items.push(child)));
    } else {
      const container = root.children.length === 1 && root.firstElementChild ? root.firstElementChild : root;
      Array.from(container.children).forEach((child) => child instanceof HTMLElement && items.push(child));
    }

    let index = 0;
    if (title) {
      title.setAttribute("data-hp-reveal-item", "title");
      title.style.setProperty("--hp-stagger-index", "0");
    }
    for (const element of items) {
      if (element === title || title?.contains(element) || element.contains(title) || !isRevealable(element)) continue;
      index = Math.min(index + 1, MAX_STAGGER_INDEX);
      element.setAttribute("data-hp-reveal-item", "card");
      element.style.setProperty("--hp-stagger-index", String(index));
    }
    // Sem título marcado, o primeiro filho (normalmente o cabeçalho da seção) já abre a cascata.
  }, [routeKey, skipInitial]);

  return <div key={routeKey} ref={rootRef} {...props}>{children}</div>;
}
