import { wordToArpabet } from '@ingglish/g2p';

type Language = 'zh' | 'ja' | 'ko' | 'ru' | 'fr' | 'es' | 'de';
type SiteNames = Partial<Record<Language | 'en', string>>;
const siteNames = new Map<string, SiteNames>([
  ['apple', { zh: '艾普尔', ja: 'アップル', ko: '애플', ru: 'Эппл', fr: 'Apeul', es: 'Ápol', de: 'Äppel' }],
  ['github', { en: 'GitHub', zh: '吉特哈布', ja: 'ギットハブ', ko: '깃허브', ru: 'Гитхаб' }],
  ['gitlab', { en: 'GitLab', zh: '吉特拉布', ja: 'ギットラブ', ko: '깃랩', ru: 'Гитлаб' }],
  ['google', { zh: '古格尔', ja: 'グーグル', ko: '구글', ru: 'Гугл' }],
  ['microsoft', { zh: '麦克罗索夫特', ja: 'マイクロソフト', ko: '마이크로소프트', ru: 'Майкрософт' }],
  ['openai', { en: 'OpenAI', zh: '欧彭诶艾', ja: 'オープンエーアイ', ko: '오픈에이아이', ru: 'Оупенэйай' }],
  ['chatgpt', { en: 'ChatGPT', zh: '查特吉皮提', ja: 'チャットジーピーティー', ko: '챗지피티' }],
  ['stackoverflow', { en: 'Stack Overflow' }],
  ['wikipedia', { zh: '威基佩迪亚', ja: 'ウィキペディア', ko: '위키피디아', ru: 'Википедия' }],
  ['youtube', { en: 'YouTube', zh: '优图布', ja: 'ユーチューブ', ko: '유튜브', ru: 'Ютуб' }],
]);

const letters: Record<Language, string[]> = {
  zh: '诶 比 西 迪 伊 艾弗 吉 艾奇 艾 杰 凯 艾勒 艾姆 恩 欧 皮 丘 阿尔 艾丝 提 优 维 达布柳 艾克斯 歪 泽德'.split(' '),
  ja: 'エー ビー シー ディー イー エフ ジー エイチ アイ ジェイ ケー エル エム エヌ オー ピー キュー アール エス ティー ユー ブイ ダブリュー エックス ワイ ゼッド'.split(' '),
  ko: '에이 비 시 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 아르 에스 티 유 브이 더블유 엑스 와이 제드'.split(' '),
  ru: 'Эй Би Си Ди И Эф Джи Эйч Ай Джей Кей Эл Эм Эн Оу Пи Кью Ар Эс Ти Ю Ви Даблъю Икс Уай Зед'.split(' '),
  fr: 'É Bi Si Di I Èf Dji Ètch Aï Djé Ké Èl Èm Èn O Pi Kiou Ar Ès Ti You Vi Deubeulyou Èks Waï Zèd'.split(' '),
  es: 'Ei Bi Si Di I Ef Yi Eich Ai Yei Kei El Em En Ou Pi Kiu Ar Es Ti Yu Vi Dábliu Éks Uái Zed'.split(' '),
  de: 'Ey Bie Sie Die Ih Eff Dschie Äitsch Ai Dschey Key Ell Em Enn Oh Pie Kju Ar Ess Tie Ju Wie Dablju Eks Wai Zedd'.split(' '),
};

const vowels: Readonly<Record<string, number>> = {
  AA: 0, AE: 0, AH: 0, AO: 3, AW: 0, AY: 0, EH: 1, ER: 1, EY: 1, IH: 2, IY: 2, OW: 3, OY: 3, UH: 4, UW: 4,
};

// Each row spells one English onset with the approximate a, e, i, o and u vowels, followed by its standalone form.
const syllables: Readonly<Record<string, readonly [chinese: string, japanese: string]>> = {
  B: ['巴贝比博布布', 'バ ベ ビ ボ ブ ブ'], CH: ['查切奇乔楚奇', 'チャ チェ チ チョ チュ チ'],
  D: ['达德迪多杜德', 'ダ デ ディ ド ドゥ ド'], DH: ['达德迪多杜德', 'ダ デ ディ ド ドゥ ド'],
  F: ['法费菲佛福弗', 'ファ フェ フィ フォ フ フ'], G: ['加格吉戈古格', 'ガ ゲ ギ ゴ グ グ'],
  HH: ['哈赫希霍胡赫', 'ハ ヘ ヒ ホ フ ハ'], JH: ['贾杰吉乔朱吉', 'ジャ ジェ ジ ジョ ジュ ジ'],
  K: ['卡凯基科库克', 'カ ケ キ コ ク ク'], L: ['拉勒利洛卢尔', 'ラ レ リ ロ ル ル'],
  M: ['马梅米莫穆姆', 'マ メ ミ モ ム ム'], N: ['纳内尼诺努恩', 'ナ ネ ニ ノ ヌ ン'],
  NG: ['昂恩英翁翁昂', 'ンガ ンゲ ンギ ンゴ ング ング'], P: ['帕佩皮波普普', 'パ ペ ピ ポ プ プ'],
  R: ['拉雷里罗鲁尔', 'ラ レ リ ロ ル ー'], S: ['萨塞西索苏斯', 'サ セ シ ソ ス ス'],
  SH: ['沙谢希绍舒什', 'シャ シェ シ ショ シュ シュ'], T: ['塔泰提托图特', 'タ テ ティ ト トゥ ト'],
  TH: ['萨瑟西索苏斯', 'サ セ シ ソ ス ス'], V: ['瓦维维沃乌夫', 'ヴァ ヴェ ヴィ ヴォ ヴ ヴ'],
  W: ['瓦韦维沃乌乌', 'ワ ウェ ウィ ウォ ウ ウ'], Y: ['雅耶伊约尤伊', 'ヤ イェ イ ヨ ユ イ'],
  Z: ['扎泽兹佐祖兹', 'ザ ゼ ジ ゾ ズ ズ'], ZH: ['扎热日若茹什', 'ジャ ジェ ジ ジョ ジュ ジ'],
};

const chineseVowels: Readonly<Record<string, string>> = {
  AA: '阿', AE: '艾', AH: '阿', AO: '奥', AW: '奥', AY: '艾', EH: '埃', ER: '尔', EY: '诶',
  IH: '伊', IY: '伊', OW: '欧', OY: '奥伊', UH: '乌', UW: '乌',
};
const traditional: Readonly<Record<string, string>> = {
  诶: '誒', 尔: '爾', 麦: '麥', 罗: '羅', 亚: '亞', 优: '優', 图: '圖', 欧: '歐',
  杰: '傑', 凯: '凱', 丝: '絲', 维: '維', 达: '達', 泽: '澤', 贝: '貝', 乔: '喬', 费: '費', 卢: '盧',
  马: '馬', 纳: '納', 内: '內', 诺: '諾', 萨: '薩', 谢: '謝', 绍: '紹', 乌: '烏', 韦: '韋', 约: '約',
  兹: '茲', 热: '熱', 奥: '奧', 贾: '賈', 鲁: '魯',
};

function syllabicName(phones: string[], language: 'zh' | 'ja'): string {
  let result = '';
  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];
    const vowel = vowels[phone];
    if (vowel !== undefined) {
      result += language === 'zh' ? chineseVowels[phone] : 'アエイオウ'[vowel];
    } else {
      const next = vowels[phones[i + 1]];
      const row = syllables[phone];
      result += language === 'zh' ? row[0][next ?? 5] : row[1].split(' ')[next ?? 5];
      if (next !== undefined) i++;
    }
  }
  return result;
}

// Hangul consonant indexes supply the onset, the coda, and a syllable for unsyllabified consonants.
const koreanConsonants: Readonly<Record<string, readonly [onset: number, coda: number, solo: string]>> = {
  B: [7, 0, '브'], CH: [14, 0, '치'], D: [3, 0, '드'], DH: [3, 0, '드'], F: [17, 0, '프'], G: [0, 0, '그'],
  HH: [18, 0, '흐'], JH: [12, 0, '지'], K: [15, 1, '크'], L: [5, 8, '르'], M: [6, 16, '므'], N: [2, 4, '느'],
  NG: [11, 21, '응'], P: [17, 0, '프'], R: [5, 0, '르'], S: [9, 0, '스'], SH: [9, 0, '시'], T: [16, 0, '트'],
  TH: [9, 0, '스'], V: [7, 0, '브'], W: [11, 0, '우'], Y: [11, 0, '이'], Z: [12, 0, '즈'], ZH: [12, 0, '지'],
};
const koreanVowels: Readonly<Record<string, number>> = {
  AA: 0, AE: 1, AH: 4, AO: 8, AW: 0, AY: 0, EH: 5, ER: 4, EY: 5, IH: 20, IY: 20, OW: 8, OY: 8, UH: 13, UW: 13,
};

function koreanName(phones: string[]): string {
  let result = '';
  for (let i = 0; i < phones.length; i++) {
    const consonant = koreanConsonants[phones[i]];
    const vowel = koreanVowels[phones[i + Number(Boolean(consonant))]];
    if (vowel === undefined) {
      result += consonant[2];
      continue;
    }
    if (consonant) i++;
    const coda = koreanVowels[phones[i + 2]] === undefined ? koreanConsonants[phones[i + 1]]?.[1] ?? 0 : 0;
    result += String.fromCharCode(0xac00 + ((consonant?.[0] ?? 11) * 21 + vowel) * 28 + coda);
    if (coda) i++;
  }
  return result;
}

type AlphabeticLanguage = 'ru' | 'fr' | 'es' | 'de';
const spellings: Readonly<Record<string, Record<AlphabeticLanguage, string>>> = Object.fromEntries([
  ['AA', 'а', 'a', 'a', 'a'], ['AE', 'э', 'a', 'a', 'ä'], ['AH', 'а', 'e', 'a', 'a'], ['AO', 'о', 'o', 'o', 'o'],
  ['AW', 'ау', 'aou', 'au', 'au'], ['AY', 'ай', 'aï', 'ai', 'ai'], ['EH', 'э', 'è', 'e', 'e'], ['ER', 'эр', 'eur', 'er', 'ör'],
  ['EY', 'эй', 'é', 'ei', 'ej'], ['IH', 'и', 'i', 'i', 'i'], ['IY', 'и', 'i', 'i', 'ie'], ['OW', 'оу', 'o', 'ou', 'o'],
  ['OY', 'ой', 'oï', 'oi', 'oi'], ['UH', 'у', 'ou', 'u', 'u'], ['UW', 'у', 'ou', 'u', 'u'],
  ['B', 'б', 'b', 'b', 'b'], ['CH', 'ч', 'tch', 'ch', 'tsch'], ['D', 'д', 'd', 'd', 'd'], ['DH', 'д', 'd', 'd', 'd'],
  ['F', 'ф', 'f', 'f', 'f'], ['G', 'г', 'g', 'g', 'g'], ['HH', 'х', 'h', 'j', 'h'], ['JH', 'дж', 'dj', 'y', 'dsch'],
  ['K', 'к', 'k', 'k', 'k'], ['L', 'л', 'l', 'l', 'l'], ['M', 'м', 'm', 'm', 'm'], ['N', 'н', 'n', 'n', 'n'],
  ['NG', 'нг', 'ng', 'ng', 'ng'], ['P', 'п', 'p', 'p', 'p'], ['R', 'р', 'r', 'r', 'r'], ['S', 'с', 's', 's', 'ss'],
  ['SH', 'ш', 'ch', 'sh', 'sch'], ['T', 'т', 't', 't', 't'], ['TH', 'т', 'th', 'z', 't'], ['V', 'в', 'v', 'v', 'w'],
  ['W', 'у', 'w', 'u', 'w'], ['Y', 'й', 'y', 'y', 'j'], ['Z', 'з', 'z', 's', 's'], ['ZH', 'ж', 'j', 'y', 'sch'],
].map(([phone, ru, fr, es, de]) => [phone, { ru, fr, es, de }]));

function phoneticName(word: string, language: Language): string {
  const known = siteNames.get(word)?.[language];
  if (known) return known;
  if (word.length === 1 || !/[aeiouy]/.test(word)) {
    return Array.from(word, letter => letters[language][letter.charCodeAt(0) - 97]).join('');
  }
  const phones = wordToArpabet(word).map(phone => phone.replace(/[012]$/, ''));
  if (language === 'zh' || language === 'ja') return syllabicName(phones, language);
  if (language === 'ko') return koreanName(phones);
  return phones.map(phone => spellings[phone][language]).join('');
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function islandName(site: string, stem: string, language: string): string {
  if (stem === site || stem.startsWith('xn--')) return site;
  if (!/^[a-z\d-]+$/.test(stem)) return stem;
  const base = language.split('-')[0].toLowerCase();
  const words = stem.split('-').filter(Boolean);
  if (!Object.prototype.hasOwnProperty.call(letters, base)) {
    return words.map(word => siteNames.get(word)?.en ?? titleCase(word)).join(' ');
  }
  const locale = base as Language;
  const separator = locale === 'zh' ? '·' : locale === 'ja' ? '・' : ' ';
  const result = words.map(word => titleCase(word.replace(/[a-z]+/g, part => phoneticName(part, locale)))).join(separator);
  return locale === 'zh' && /-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language)
    ? Array.from(result, character => traditional[character] ?? character).join('')
    : result;
}
