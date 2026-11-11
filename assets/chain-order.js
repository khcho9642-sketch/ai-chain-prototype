// Display position is independent of legacy IDs used by quotes, metrics and links.
export const SECTOR_DISPLAY_IDS = Object.freeze([
  'semiconductor-equipment', 'memory', 'foundry-packaging', 'ai-chips', 'ai-equipment',
  'optical-communications', 'power-cooling', 'data-centers', 'cloud-gpu', 'ai-models',
])

export const legacyChains = Object.freeze([
  { id: 1, name: '소부장' },
  { id: 3, name: '메모리' },
  { id: 2, name: '파운드리·패키징' },
  { id: 4, name: 'AI 칩' },
  { id: 5, name: '전력' },
  { id: 6, name: '인프라' },
  { id: 7, name: '모델' },
  { id: 8, name: '애플리케이션' },
].map(Object.freeze))

const chainById = new Map(legacyChains.map((chain, index) => [chain.id, { ...chain, number: index + 1 }]))
export const chainName = id => chainById.get(id)?.name
export const chainDisplayNumber = id => chainById.get(id)?.number
export const chainsFor = ids => legacyChains.filter(({ id }) => ids.includes(id))
