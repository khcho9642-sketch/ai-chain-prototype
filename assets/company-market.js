import { instruments } from './instruments.js';

// Load the existing browser tools only while their tab is active.
function mountWhenReady(container, load, start) {
  let disposed = false;
  let unmount;
  load().then(module => {
    if (!disposed) unmount = start(module);
  }).catch(() => {
    if (!disposed) container.textContent = '자료를 열 수 없습니다. 잠시 후 다시 시도해 주세요.';
  });
  return () => { disposed = true; unmount?.(); };
}

export function mountQuote(container, company) {
  return mountWhenReady(container, () => import('./dashboard.js'), module => module.mountCompanyQuote(container, company));
}

export function mountSources(container, company) {
  return mountWhenReady(container, () => import('./company-directory.js'), module => module.mountCompanyFilings(container, company.dartSymbol));
}

const discussions = new Set(instruments.filter(item => item.chains.some(id => id > 0)).map(item => item.symbol));
export function discussionHref(company) {
  const symbol = company.discussionTicker;
  return discussions.has(symbol) ? '#talk/' + encodeURIComponent(symbol) : null;
}
