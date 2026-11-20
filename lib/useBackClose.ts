'use client';

import { useEffect, useRef } from 'react';

type Closer = () => void;
const stack: Closer[] = [];
let swallow = 0;
let skipBack = 0;
let bound = false;

function onPop() {
  if (swallow > 0) { swallow--; return; }
  const top = stack[stack.length - 1];
  if (top) top();
}

function bind() {
  if (bound) return;
  bound = true;
  window.addEventListener('popstate', onPop);
}

// Call before closing a layer as part of a route navigation so the cleanup
// does not issue a history.back() that would undo the navigation.
export function closeLayerWithoutBack() {
  skipBack++;
}

export function useBackClose(active: boolean, close: Closer) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    bind();
    const entry: Closer = () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      closeRef.current();
    };
    // Defer the push so React StrictMode's probe mount/cleanup cycle in dev
    // cancels before touching history, keeping push/back perfectly paired.
    let pushed = false;
    const timer = setTimeout(() => {
      pushed = true;
      stack.push(entry);
      history.pushState({ ...(history.state || {}), exposingLayer: stack.length }, '');
    }, 0);
    return () => {
      clearTimeout(timer);
      if (!pushed) return;
      const i = stack.indexOf(entry);
      if (i >= 0) {
        stack.splice(i, 1);
        if (skipBack > 0) { skipBack--; return; }
        swallow++;
        history.back();
      }
    };
  }, [active]);
}