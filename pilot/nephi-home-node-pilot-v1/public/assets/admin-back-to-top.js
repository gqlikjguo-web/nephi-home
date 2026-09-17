"use strict";
// Shared page chrome only: no property, availability or conversation state.
(() => {
  const button = document.getElementById('adminBackToTop');
  const workspace = document.getElementById('workspace');
  if (!button || !workspace) return;
  function update() {
    const editing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    button.hidden = workspace.hidden || window.scrollY < 320 || editing || Boolean(document.querySelector('dialog[open]'));
  }
  button.onclick = () => window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  window.addEventListener('scroll',update,{passive:true});
  window.addEventListener('resize',update);
  document.addEventListener('focusin',update);
  document.addEventListener('focusout',() => requestAnimationFrame(update));
  new MutationObserver(update).observe(workspace,{attributes:true,attributeFilter:['hidden','open'],subtree:true});
  update();
})();
