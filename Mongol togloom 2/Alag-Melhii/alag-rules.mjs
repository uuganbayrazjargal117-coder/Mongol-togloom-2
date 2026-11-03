// Shared logical catalog; positions, colors and Three.js objects remain in game.js.
export const ALAG_GROUPS = Object.freeze([
  {
    "id": "back-1",
    "name": "Нуруу · 1-р эгнээ",
    "n": 6
  },
  {
    "id": "back-2",
    "name": "Нуруу · 2-р эгнээ",
    "n": 6
  },
  {
    "id": "back-3",
    "name": "Нуруу · 3-р эгнээ",
    "n": 6
  },
  {
    "id": "back-4",
    "name": "Нуруу · 4-р эгнээ",
    "n": 6
  },
  {
    "id": "back-5",
    "name": "Нуруу · 5-р эгнээ",
    "n": 6
  },
  {
    "id": "back-6",
    "name": "Нуруу · 6-р эгнээ",
    "n": 6
  },
  {
    "id": "neck",
    "name": "Хүзүү",
    "n": 6
  },
  {
    "id": "head",
    "name": "Толгой",
    "n": 3
  },
  {
    "id": "eyes",
    "name": "Нүд",
    "n": 2
  },
  {
    "id": "ears",
    "name": "Чих",
    "n": 2
  },
  {
    "id": "tail",
    "name": "Сүүл",
    "n": 3
  },
  {
    "id": "leg-front-left",
    "name": "Зүүн урд шилбэ",
    "n": 4
  },
  {
    "id": "foot-front-left",
    "name": "Зүүн урд тавхай",
    "n": 5
  },
  {
    "id": "earth",
    "name": "Шороо",
    "n": 1
  },
  {
    "id": "leg-front-right",
    "name": "Баруун урд шилбэ",
    "n": 4
  },
  {
    "id": "foot-front-right",
    "name": "Баруун урд тавхай",
    "n": 5
  },
  {
    "id": "sky",
    "name": "Огторгуй",
    "n": 1
  },
  {
    "id": "leg-back-left",
    "name": "Зүүн хойд шилбэ",
    "n": 4
  },
  {
    "id": "foot-back-left",
    "name": "Зүүн хойд тавхай",
    "n": 5
  },
  {
    "id": "mountain",
    "name": "Уул",
    "n": 1
  },
  {
    "id": "leg-back-right",
    "name": "Баруун хойд шилбэ",
    "n": 4
  },
  {
    "id": "foot-back-right",
    "name": "Баруун хойд тавхай",
    "n": 5
  },
  {
    "id": "wind",
    "name": "Салхи",
    "n": 1
  },
  {
    "id": "heart",
    "name": "Зүрх",
    "n": 1
  },
  {
    "id": "bladder",
    "name": "Давсаг",
    "n": 1
  },
  {
    "id": "kidneys",
    "name": "Бөөр",
    "n": 2
  },
  {
    "id": "fire",
    "name": "Гал",
    "n": 4
  },
  {
    "id": "wood",
    "name": "Мод",
    "n": 5
  },
  {
    "id": "metal",
    "name": "Төмөр",
    "n": 3
  }
].map(Object.freeze));

// Matches the original local take/automatic-return eligibility rule.
export function eligibleGroups(groups, value, mode = 'take', score = 0) {
  return groups.filter(g => g.n === value && (mode === 'take' ? g.present : !g.present && score >= value));
}
