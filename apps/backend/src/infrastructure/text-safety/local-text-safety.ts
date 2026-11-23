import type { TextSafetyPort } from '../../application/ports.js';
import type { TextSafetyRequest, TextSafetyReason, TextSafetyDecision } from '../../domain/text-safety.js';
import type { Result } from '../../domain/core.js';
import { foldDecimalDigits } from './unicode-decimal.js';

export const maxInspectedTextBytes = 16000;
export type ContactCategory = 'phone_number' | 'email_address' | 'messenger_contact' | 'social_network_contact';
const encoder = new TextEncoder();
const digitSeparator = String.raw`[\s()./-]*`;

const phonePatterns: readonly RegExp[] = [
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:\+\s*\(?\s*|00${digitSeparator})\d(?:${digitSeparator}\d){7,14}(?![\p{L}\p{N}])`, 'u'),
  new RegExp(String.raw`(?<![\p{L}\p{N}])0[689](?:${digitSeparator}\d){8}(?![\p{L}\p{N}])`, 'u'),
  new RegExp(String.raw`(?<![\p{L}\p{N}])0[2-7](?:${digitSeparator}\d){7,8}(?![\p{L}\p{N}])`, 'u'),
  new RegExp(String.raw`(?<![\p{L}\p{N}])[78](?:${digitSeparator}\d){10}(?![\p{L}\p{N}])`, 'u'),
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:\([2-9]\d{2}\)|[2-9]\d{2})[\s()./-]+\d{3}[\s()./-]+\d{4}(?![\p{L}\p{N}])`, 'u'),
  /(?<![\p{L}\p{N}])[2-9]\d{9}(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:phone|telephone|mobile|cell|tel|call\s+me|contact\s+number|номер\s+телефона|телефон|позвони(?:те)?|เบอร์โทร|เบอร์มือถือ|โทรศัพท์)(?![\p{L}\p{N}])\s*(?:number\s*)?(?:is\s*)?[:=]?\s*\+?(?:[\s()./-]*\d){7,14}/iu,
];

const emailPatterns: readonly RegExp[] = [
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]+\.[\p{L}]{2,}(?![\p{L}\p{N}.-])/iu,
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{3,64}\s*(?:\[at\]|\(at\)|\bat\b)\s*[\p{L}\p{N}-]{1,63}\s*(?:\[dot\]|\(dot\)|\bdot\b)\s*[\p{L}]{2,24}(?:\s*(?:\[dot\]|\(dot\)|\bdot\b)\s*[\p{L}]{2,24})?(?![\p{L}])/iu,
];

const messengerPlatforms = String.raw`whats?app|messenger|line|telegram|wechat|weixin|viber|signal|skype|discord|kakao(?:talk)?|qq|imo|zalo`;
const socialPlatforms = String.raw`facebook|instagram(?:\s+direct)?|snapchat|tiktok(?:\s+direct\s+messages?)?|twitter|x|vk|linkedin`;
const accountValue = String.raw`[@#]?[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}_.:+#-]{1,63}`;

function platformContactPattern(platforms: string): RegExp {
  return new RegExp(
    String.raw`\b(?:${platforms})\b\s*(?:(?:id|user(?:name)?|handle|contact|profile|account|invite)\s*(?:is\s*)?[:=]?\s*|[:=]\s*|@\s*)(${accountValue})`,
    'iu',
  );
}

const messengerContactPatterns: readonly RegExp[] = [
  platformContactPattern(messengerPlatforms),
  new RegExp(String.raw`\bmy\s+(?:${messengerPlatforms})\s+is\s+(${accountValue})`, 'iu'),
  /(?:https?:\/\/)?(?:www\.)?(?:wa\.me|chat\.whatsapp\.com|t\.me|telegram\.me|m\.me|vb\.me|signal\.me|join\.skype\.com|discord\.gg|open\.kakao\.com|zalo\.me)\/[^\s<>()]+/iu,
  /(?:https?:\/\/)?(?:www\.)?(?:api\.whatsapp\.com\/send|line\.me\/R\/ti\/p|weixin\.qq\.com|discord\.com\/invite|messenger\.com\/t)\/?[^\s<>()]*/iu,
  /(?:whatsapp|viber|tg|telegram|line|signal|sgnl|discord):\/\/[^\s<>()]+/iu,
];

const socialContactPatterns: readonly RegExp[] = [
  platformContactPattern(socialPlatforms),
  new RegExp(String.raw`\bmy\s+(?:${socialPlatforms})\s+is\s+(${accountValue})`, 'iu'),
  /(?<![\p{L}\p{N}._%+-])@[\p{L}_][\p{L}\p{M}\p{N}_.-]{1,63}/u,
  /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:profile\.php\?id=[\p{L}\p{M}\p{N}_.=-]+|(?!help(?:\/|$)|about(?:\/|$)|business(?:\/|$)|watch(?:\/|$)|events?(?:\/|$)|groups?(?:\/|$)|marketplace(?:\/|$)|pages?(?:\/|$)|login(?:\/|$)|privacy(?:\/|$)|policies(?:\/|$)|terms(?:\/|$)|share(?:\/|$)|reel(?:\/|$)|story(?:\/|$)|photo(?:\/|$)|video(?:\/|$))[\p{L}\p{M}\p{N}_.-]{3,})/iu,
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?!p(?:\/|$)|reel(?:\/|$)|reels(?:\/|$)|stories(?:\/|$)|explore(?:\/|$)|accounts?(?:\/|$)|about(?:\/|$)|developer(?:\/|$))[\p{L}\p{M}\p{N}_.]{2,}/iu,
  /(?:https?:\/\/)?(?:www\.)?snapchat\.com\/add\/[\p{L}\p{M}\p{N}_.-]{2,}/iu,
  /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\p{L}\p{M}\p{N}_.-]{2,}/iu,
  /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(?!home(?:\/|$)|explore(?:\/|$)|search(?:\/|$)|intent(?:\/|$)|share(?:\/|$)|i(?:\/|$)|hashtag(?:\/|$))[\p{L}\p{M}\p{N}_.]{2,}/iu,
  /(?:https?:\/\/)?(?:www\.)?vk\.com\/(?:id\d+|[\p{L}\p{M}\p{N}_.]{2,})/iu,
  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\p{L}\p{M}\p{N}_.%-]{2,}/iu,
];

const nonHandleWords = new Set([
  'a', 'an', 'the', 'not', 'no', 'none', 'popular', 'available', 'unavailable',
  'working', 'broken', 'down', 'free', 'good', 'great', 'useful', 'installed',
  'here', 'there', 'today', 'tomorrow', 'offline', 'online', 'active', 'my',
  'friend', 'app', 'messaging', 'service', 'platform', 'is', 'was', 'are',
  'unknown', 'missing', 'disabled', 'blocked', 'notfound', 'none', 'invalid',
  'please', 'help', 'support', 'lost', 'failed', 'problem', 'error',
  'for', 'information', 'picture', 'business', 'customer', 'customers',
  'of', 'our', 'your', 'their', 'this', 'that', 'without', 'with', 'from',
]);

const addressLead = /(?<![\p{L}\p{N}])(?:address|addr|unit|apt|apartment|room|floor|building|house|condo|soi|street|road|district|subdistrict|postcode|postal\s+code|house\s+number|unit\s+number|номер\s+дома|адрес|улица|ул\.?|проспект|пр-т|переулок|пер\.?|район|р-н|дом|д\.?|корпус|корп\.?|кондо|этаж|эт\.?|квартира|кв\.?|комната|комн\.?|помещение|пом\.?|индекс|เลขที่|บ้านเลขที่|ที่อยู่|ถนน|ซอย|ชั้น|ห้อง|อาคาร|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|รหัสไปรษณีย์)(?![\p{L}\p{N}])\s*(?:(?:no\.?|number|№)\s*)?[:#-]?\s*$/iu;
const contactCallTail = /^\s*(?:[,;]\s*)?(?:call|phone|telephone|text|message|contact|whatsapp|telegram|line)\b/iu;
const explicitPhoneLead = /(?<![\p{L}\p{N}])(?:phone|telephone|mobile|cell|tel|call\s+me|contact\s+number|номер\s+телефона|телефон|позвони(?:те)?|เบอร์โทร|เบอร์มือถือ|โทรศัพท์)(?![\p{L}\p{N}])\s*(?:number\s*)?(?:is\s*)?[:=]?\s*$/iu;
const currencyLead = /(?:\b(?:THB|baht|USD|EUR|GBP|JPY|CNY|RUB)\b|บาท(?![\p{L}])|฿|\$|€|£)\s*$/iu;
const currencyTail = /^\s*(?:(?:THB|baht|USD|EUR|GBP|JPY|CNY|RUB)\b|บาท(?![\p{L}])|฿|\$|€|£)/iu;

function isAddressNumber(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 72), start);
  const after = text.slice(end, Math.min(text.length, end + 48));
  if (explicitPhoneLead.test(before)) return false;
  if (currencyLead.test(before) || currencyTail.test(after)) return true;
  return addressLead.test(before) && !contactCallTail.test(after);
}

function containsPhone(text: string): boolean {
  for (const pattern of phonePatterns) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      const start = match.index;
      if (start === undefined || !isAddressNumber(text, start, start + match[0].length)) return true;
    }
  }
  return false;
}

function patternMatches(text: string, pattern: RegExp): boolean {
  const match = pattern.exec(text);
  if (!match) return false;
  if (match[1] === undefined) return true;
  const handle = match[1].replace(/^[@#]/u, '').toLocaleLowerCase('en');
  return handle.length > 0 && !nonHandleWords.has(handle);
}

function contactReason(text: string): ContactCategory | null {
  if (containsPhone(text)) return 'phone_number';
  if (emailPatterns.some(pattern => pattern.test(text))) return 'email_address';
  if (messengerContactPatterns.some(pattern => patternMatches(text, pattern))) return 'messenger_contact';
  if (socialContactPatterns.some(pattern => patternMatches(text, pattern))) return 'social_network_contact';
  return null;
}

export function classifyJobChatContact(text: string): ContactCategory | null {
  return contactReason(foldDecimalDigits(text.normalize('NFKC')));
}

const externalPatterns: readonly [TextSafetyReason, RegExp][] = [
  ['account_identifier', /(?:\b(?:account|iban|swift|bank\s+number|passport|national\s+id|tax\s+id|username|login)\b|\u0441\u0447[\u0435\u0451]\u0442|\u043f\u0430\u0441\u043f\u043e\u0440\u0442|\u043b\u043e\u0433\u0438\u043d|\u0e1a\u0e31\u0e0d\u0e0a\u0e35|\u0e1a\u0e31\u0e15\u0e23\u0e1b\u0e23\u0e30\u0e0a\u0e32\u0e0a\u0e19)/iu],
  ['personal_data', /(?:\b(?:my\s+name|date\s+of\s+birth|born\s+on|social\s+security|medical\s+record)\b|\u043c\u0435\u043d\u044f\s+\u0437\u043e\u0432\u0443\u0442|\u0434\u0430\u0442\u0430\s+\u0440\u043e\u0436\u0434\u0435\u043d\u0438\u044f|\u0e0a\u0e37\u0e48\u0e2d\u0e02\u0e2d\u0e07|\u0e27\u0e31\u0e19\u0e40\u0e01\u0e34\u0e14)/iu],
];

export class LocalTextSafety implements TextSafetyPort {
  async inspect(request: TextSafetyRequest): Promise<Result<TextSafetyDecision>> {
    const result = (status: TextSafetyDecision['status'], reason: TextSafetyReason | null = null): Result<TextSafetyDecision> =>
      ({ ok: true, value: { ...request, status, reason } });

    if (!request || typeof request.text !== 'string' || !['job_chat', 'external_translation'].includes(request.purpose)) {
      return result('unknown');
    }

    if (request.text.length > maxInspectedTextBytes || encoder.encode(request.text).byteLength > maxInspectedTextBytes) {
      return result('unknown');
    }

    const compatible = request.text.normalize('NFKC');
    if (compatible.length > maxInspectedTextBytes || encoder.encode(compatible).byteLength > maxInspectedTextBytes) {
      return result('unknown');
    }

    const normalized = foldDecimalDigits(compatible);
    if (/[\p{Cc}\p{Cf}]/u.test(normalized.replace(/[\n\r\t]/gu, ''))) return result('unknown');

    // Прямые контакты блокируются только в чатах Client–Master по заказу.
    // Чаты HELPY с клиентом/мастером и другие внешние переводы этим правилом не затрагиваются.
    if (request.purpose === 'job_chat') {
      const reason = contactReason(normalized);
      if (reason) return result('rejected', 'contact');
    }

    if (request.purpose === 'external_translation') {
      for (const [reason, pattern] of externalPatterns) {
        if (pattern.test(normalized)) return result('rejected', reason);
      }
    }

    if (!normalized.trim() || /[^\p{Letter}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}\n\r\t+*=<>%$\u2212]/u.test(normalized)) {
      return result('unknown');
    }

    return result('allowed');
  }
}
