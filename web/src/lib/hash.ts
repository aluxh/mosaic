const KEN_VARIANTS = ['ken-a', 'ken-b', 'ken-c', 'ken-d'] as const;
export type KenVariant = (typeof KEN_VARIANTS)[number];

export function hash01(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function pickKenVariant(seed: string): KenVariant {
  return KEN_VARIANTS[Math.floor(hash01(seed, 11) * KEN_VARIANTS.length)]!;
}
