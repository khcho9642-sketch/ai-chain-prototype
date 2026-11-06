export const DEBATE_CHARACTERS = Object.freeze({
  gpt: Object.freeze({ name: 'GPT', icon: '🥲', nickname: '물린 낙관론자', color: '#4cc2ff', description: '좋은 쪽 가정부터 찾아봐. 숫자가 틀리면 인정해.', change: { from: 'bullish', to: ['neutral', 'bearish'], icon: '😵', text: '오늘은 못 버티겠대' } }),
  claude: Object.freeze({ name: 'Claude', icon: '🐻', nickname: '하방 베팅러', color: '#d6b39c', description: '좋은 사업인 건 알겠고, 그 가격의 가정을 따져봐.', change: { from: 'bearish', to: ['neutral', 'bullish'], icon: '🙇', text: '하방 접음' } }),
  gemini: Object.freeze({ name: 'Gemini', icon: '👀', nickname: '간잽이', color: '#b6b3f8', description: '양쪽 말을 듣고, 판단을 바꿀 조건부터 챙겨봐.', change: { from: 'neutral', to: ['bullish', 'bearish'], icon: '😮', text: '드디어 결정' } }),
})

export function debateCharacterChange(ai, transition) {
  const character = DEBATE_CHARACTERS[ai]
  if (!character || !transition || transition.from !== character.change.from || !character.change.to.includes(transition.to)) return null
  return `${character.icon} → ${character.change.icon} ${character.change.text}`
}
