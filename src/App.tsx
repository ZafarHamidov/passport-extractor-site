import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  FileJson,
  ImagePlus,
  Layers,
  Languages,
  Loader2,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import { parse, type Details, type ParseResult } from 'mrz';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type RecordStatus = 'queued' | 'processing' | 'done' | 'needs-review' | 'error';

type ExtractedFields = {
  passportNumber: string;
  documentCode: string;
  issuingState: string;
  nationality: string;
  lastName: string;
  firstNames: string;
  birthDate: string;
  sex: string;
  expirationDate: string;
  personalNumber: string;
};

type NormalizedFields = Pick<ExtractedFields, 'birthDate' | 'expirationDate'>;

type ExtractionAttempt = {
  rotation: number;
  crop: string;
  variant: string;
  score: number;
  candidateCount: number;
};

type AiSeverity = 'good' | 'warning' | 'critical';

type AiIssue = {
  id: string;
  severity: AiSeverity;
  messageKey: string;
  detail?: string;
};

type AiSuggestion = {
  id: string;
  field: FieldKey;
  labelKey: string;
  suggestedValue: string;
  currentValue: string;
  reasonKey: string;
  confidence: number;
};

type AiReview = {
  confidence: number;
  summaryKey: string;
  issues: AiIssue[];
  suggestions: AiSuggestion[];
};

type PassportRecord = {
  id: string;
  file: File;
  sourceFileName: string;
  embeddedText: string;
  previewUrl: string;
  status: RecordStatus;
  progress: number;
  message: string;
  rotationAngle: number;
  previewZoom: number;
  fields: ExtractedFields;
  normalizedFields: NormalizedFields;
  rawMrz: string;
  valid: boolean | null;
  validationDetails: Details[];
  ocrText: string;
  visualOcrText: string;
  extractionAttempt: ExtractionAttempt | null;
  error: string;
};

type FieldKey = keyof ExtractedFields;

type AppLanguage = 'en' | 'ru';

type PdfPageOption = {
  pageNumber: number;
  thumbnailUrl: string;
  selected: boolean;
  width: number;
  height: number;
};

type PdfDialogState = {
  id: string;
  file: File;
  fileName: string;
  pages: PdfPageOption[];
  error: string;
};

type RenderedPdfPage = {
  file: File;
  sourceFileName: string;
  embeddedText: string;
};

type ParsedCandidate = {
  result: ParseResult;
  lines: string[];
  score: number;
  candidateCount: number;
};

const translations = {
  en: {
    appTitle: "Zafar's Passport Extractor",
    subtitle: 'Device-only passport OCR',
    upload: 'Upload',
    camera: 'Camera',
    json: 'JSON',
    csv: 'CSV',
    clearAll: 'Clear all',
    dropTitle: 'Drop passport images or PDFs here',
    dropFormats: 'JPEG, PNG, WebP, PDF',
    total: 'total',
    valid: 'valid',
    review: 'review',
    ocrIdle: 'OCR idle',
    ocrLoading: 'OCR loading',
    ocrReady: 'OCR ready',
    noPassports: 'No passports loaded',
    emptyHint: 'Upload or capture passport images to start a private extraction session.',
    queued: 'Queued',
    processing: 'Processing',
    done: 'Valid',
    needsReview: 'Review',
    error: 'Error',
    waiting: 'Waiting',
    preparingImage: 'Preparing image',
    tryingEmbeddedText: 'Checking PDF text',
    readingMrz: 'Reading MRZ',
    readingVisualText: 'Reading visual text',
    parsingData: 'Parsing data',
    manualReview: 'Manual review',
    extracted: 'Extracted',
    checkFields: 'Check fields',
    failed: 'Failed',
    retry: 'Retry',
    remove: 'Remove',
    reextract: 'Re-extract',
    rotateLeft: '-90',
    rotateRight: '+90',
    rotateHalf: '180',
    reset: 'Reset',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    rotation: 'Rotation',
    dragToRotate: 'Drag to rotate',
    passportNumber: 'Passport number',
    lastName: 'Surname',
    firstNames: 'Given names',
    issuingState: 'Issuing country',
    nationality: 'Nationality',
    birthDate: 'Birth date',
    sex: 'Sex',
    expirationDate: 'Expiry date',
    documentCode: 'Document code',
    personalNumber: 'Personal number',
    rawMrz: 'Raw MRZ',
    visualText: 'Visual text',
    validationDetails: 'Validation details',
    ocrText: 'MRZ OCR text',
    extractionDetails: 'Extraction details',
    noValidation: 'No validation data yet.',
    noOcrText: 'No OCR text yet.',
    noVisualText: 'No visual text yet.',
    copyFailed: 'Copy failed',
    unsupportedFile: 'Unsupported file type',
    pdfFailed: 'PDF failed',
    pdfImport: 'PDF import',
    selectedPages: 'pages selected',
    selectAll: 'Select all',
    selectNone: 'Select none',
    page: 'Page',
    cancel: 'Cancel',
    importSelected: 'Import selected',
    rendering: 'Rendering',
    preparingPdf: 'Preparing PDF',
    selectAtLeastOne: 'Select at least one page to import.',
    noMrzFound: 'No valid TD3 passport MRZ candidate was found.',
    mrzInvalid: 'MRZ was parsed but one or more check fields did not validate.',
    canvasUnavailable: 'Canvas is not available in this browser.',
    pdfRenderFailed: 'Could not render PDF page.',
    ocrFailed: 'OCR failed.',
    validLabel: 'Valid',
    invalidLabel: 'Invalid',
    copied: 'copied',
    languageToggle: 'RU',
    extractionAttemptPrefix: 'Best attempt',
    aiAssistant: 'AI review',
    aiPrivate: 'Local assistant. Nothing is uploaded.',
    aiConfidence: 'AI confidence',
    aiApply: 'Apply',
    aiApplyAll: 'Apply all',
    aiSuggestions: 'Suggested fixes',
    aiChecks: 'AI checks',
    aiNoSuggestions: 'No suggested fixes.',
    aiNoIssues: 'No issues found.',
    aiSummaryStrong: 'Looks ready to copy after a quick visual check.',
    aiSummaryReview: 'Review the highlighted fields before copying.',
    aiSummaryManual: 'Needs manual review before use.',
    aiMissingPassportNumber: 'Passport number is missing.',
    aiMissingRequiredFields: 'Required travel fields are missing.',
    aiInvalidCheckDigits: 'MRZ check digits need review.',
    aiExpiredPassport: 'Passport appears expired.',
    aiExpiringSoon: 'Passport expires soon.',
    aiInvalidBirthDate: 'Birth date looks invalid.',
    aiUnusualPassportNumber: 'Passport number format looks unusual.',
    aiNoMrzText: 'MRZ text was not found.',
    aiForeignTextFound: 'Foreign-language visual text was detected.',
    aiRotationMismatch: 'Best OCR result used a different rotation.',
    aiLowOcrConfidence: 'OCR confidence is low.',
    aiUseMrzSuggestion: 'MRZ parse suggests this value.',
    aiSuggestionArrow: 'to',
    fastMode: 'Fast',
    deepScanMode: 'Deep scan',
    fastModeHint: 'Faster processing: MRZ first, visual text on demand.',
    deepScanHint: 'Slower processing: more MRZ attempts for difficult images.',
    visualOcrButton: 'Visual OCR',
    visualOcrRunning: 'Reading...',
  },
  ru: {
    appTitle: 'Паспортный экстрактор Zafar',
    subtitle: 'OCR паспорта только на устройстве',
    upload: 'Загрузить',
    camera: 'Камера',
    json: 'JSON',
    csv: 'CSV',
    clearAll: 'Очистить',
    dropTitle: 'Перетащите фото паспорта или PDF сюда',
    dropFormats: 'JPEG, PNG, WebP, PDF',
    total: 'всего',
    valid: 'верно',
    review: 'проверить',
    ocrIdle: 'OCR готов к старту',
    ocrLoading: 'OCR загружается',
    ocrReady: 'OCR готов',
    noPassports: 'Паспорта не загружены',
    emptyHint: 'Загрузите или сфотографируйте паспорт, чтобы начать приватное распознавание.',
    queued: 'В очереди',
    processing: 'Обработка',
    done: 'Верно',
    needsReview: 'Проверить',
    error: 'Ошибка',
    waiting: 'Ожидание',
    preparingImage: 'Подготовка изображения',
    tryingEmbeddedText: 'Проверка текста PDF',
    readingMrz: 'Чтение MRZ',
    readingVisualText: 'Чтение видимого текста',
    parsingData: 'Разбор данных',
    manualReview: 'Ручная проверка',
    extracted: 'Извлечено',
    checkFields: 'Проверьте поля',
    failed: 'Сбой',
    retry: 'Повторить',
    remove: 'Удалить',
    reextract: 'Распознать заново',
    rotateLeft: '-90',
    rotateRight: '+90',
    rotateHalf: '180',
    reset: 'Сброс',
    zoomIn: 'Приблизить',
    zoomOut: 'Отдалить',
    rotation: 'Поворот',
    dragToRotate: 'Тяните для поворота',
    passportNumber: 'Номер паспорта',
    lastName: 'Фамилия',
    firstNames: 'Имена',
    issuingState: 'Страна выдачи',
    nationality: 'Гражданство',
    birthDate: 'Дата рождения',
    sex: 'Пол',
    expirationDate: 'Срок действия',
    documentCode: 'Код документа',
    personalNumber: 'Личный номер',
    rawMrz: 'Исходная MRZ',
    visualText: 'Видимый текст',
    validationDetails: 'Проверка',
    ocrText: 'MRZ OCR текст',
    extractionDetails: 'Детали извлечения',
    noValidation: 'Данных проверки пока нет.',
    noOcrText: 'OCR текста пока нет.',
    noVisualText: 'Видимого текста пока нет.',
    copyFailed: 'Не удалось скопировать',
    unsupportedFile: 'Неподдерживаемый тип файла',
    pdfFailed: 'PDF не обработан',
    pdfImport: 'Импорт PDF',
    selectedPages: 'страниц выбрано',
    selectAll: 'Выбрать все',
    selectNone: 'Снять выбор',
    page: 'Страница',
    cancel: 'Отмена',
    importSelected: 'Импортировать',
    rendering: 'Рендеринг',
    preparingPdf: 'Подготовка PDF',
    selectAtLeastOne: 'Выберите хотя бы одну страницу.',
    noMrzFound: 'Не найден подходящий MRZ паспорта TD3.',
    mrzInvalid: 'MRZ распознан, но часть контрольных полей не прошла проверку.',
    canvasUnavailable: 'Canvas недоступен в этом браузере.',
    pdfRenderFailed: 'Не удалось отрисовать страницу PDF.',
    ocrFailed: 'Ошибка OCR.',
    validLabel: 'Верно',
    invalidLabel: 'Неверно',
    copied: 'скопировано',
    languageToggle: 'EN',
    aiAssistant: 'AI проверка',
    aiPrivate: 'Локальный помощник. Данные не отправляются.',
    aiConfidence: 'Уверенность AI',
    aiApply: 'Применить',
    aiApplyAll: 'Применить все',
    aiSuggestions: 'Предложенные исправления',
    aiChecks: 'AI проверки',
    aiNoSuggestions: 'Нет предложений.',
    aiNoIssues: 'Проблем не найдено.',
    aiSummaryStrong: 'Можно копировать после короткой визуальной проверки.',
    aiSummaryReview: 'Проверьте выделенные поля перед копированием.',
    aiSummaryManual: 'Нужна ручная проверка перед использованием.',
    aiMissingPassportNumber: 'Номер паспорта не найден.',
    aiMissingRequiredFields: 'Не хватает обязательных полей для билета.',
    aiInvalidCheckDigits: 'Контрольные цифры MRZ требуют проверки.',
    aiExpiredPassport: 'Паспорт выглядит просроченным.',
    aiExpiringSoon: 'Паспорт скоро истекает.',
    aiInvalidBirthDate: 'Дата рождения выглядит неверно.',
    aiUnusualPassportNumber: 'Формат номера паспорта необычный.',
    aiNoMrzText: 'MRZ текст не найден.',
    aiForeignTextFound: 'Найден видимый текст на иностранном языке.',
    aiRotationMismatch: 'Лучший OCR результат использовал другой поворот.',
    aiLowOcrConfidence: 'Уверенность OCR низкая.',
    aiUseMrzSuggestion: 'MRZ предлагает это значение.',
    aiSuggestionArrow: 'на',
    fastMode: 'Быстро',
    deepScanMode: 'Глубокий поиск',
    fastModeHint: 'Быстрая обработка: сначала MRZ, видимый текст по запросу.',
    deepScanHint: 'Медленнее: больше попыток MRZ для сложных изображений.',
    visualOcrButton: 'Видимый OCR',
    visualOcrRunning: 'Чтение...',
    extractionAttemptPrefix: 'Лучшая попытка',
  },
} satisfies Record<AppLanguage, Record<string, string>>;

const fieldLabels: Array<{ key: FieldKey; labelKey: string; prominent?: boolean }> = [
  { key: 'passportNumber', labelKey: 'passportNumber', prominent: true },
  { key: 'lastName', labelKey: 'lastName' },
  { key: 'firstNames', labelKey: 'firstNames' },
  { key: 'issuingState', labelKey: 'issuingState' },
  { key: 'nationality', labelKey: 'nationality' },
  { key: 'birthDate', labelKey: 'birthDate' },
  { key: 'sex', labelKey: 'sex' },
  { key: 'expirationDate', labelKey: 'expirationDate' },
  { key: 'documentCode', labelKey: 'documentCode' },
  { key: 'personalNumber', labelKey: 'personalNumber' },
];

const emptyFields: ExtractedFields = {
  passportNumber: '',
  documentCode: '',
  issuingState: '',
  nationality: '',
  lastName: '',
  firstNames: '',
  birthDate: '',
  sex: '',
  expirationDate: '',
  personalNumber: '',
};

const emptyNormalizedFields: NormalizedFields = {
  birthDate: '',
  expirationDate: '',
};

const mrzCropBands = [
  { name: 'lower', start: 0.52, end: 1 },
  { name: 'lower-tight', start: 0.62, end: 0.98 },
  { name: 'mid-lower', start: 0.42, end: 1 },
];

const mrzVariants = ['contrast', 'binary'] as const;

const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isAcceptedImage(file: File) {
  return (
    acceptedImageTypes.has(file.type) ||
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

function isAcceptedPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function createRecord(file: File, sourceFileName = file.name || 'camera-capture.jpg', embeddedText = ''): PassportRecord {
  return {
    id: crypto.randomUUID(),
    file,
    sourceFileName,
    embeddedText,
    previewUrl: URL.createObjectURL(file),
    status: 'queued',
    progress: 0,
    message: 'Waiting',
    rotationAngle: 0,
    previewZoom: 1,
    fields: { ...emptyFields },
    normalizedFields: { ...emptyNormalizedFields },
    rawMrz: '',
    valid: null,
    validationDetails: [],
    ocrText: '',
    visualOcrText: '',
    extractionAttempt: null,
    error: '',
  };
}

function statusLabel(status: RecordStatus, t: (key: string) => string) {
  switch (status) {
    case 'queued':
      return t('queued');
    case 'processing':
      return t('processing');
    case 'done':
      return t('done');
    case 'needs-review':
      return t('needsReview');
    case 'error':
      return t('error');
  }
}

function getStatusIcon(status: RecordStatus) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={15} />;
    case 'needs-review':
      return <AlertTriangle size={15} />;
    case 'error':
      return <X size={15} />;
    case 'processing':
      return <Loader2 size={15} className="spin" />;
    case 'queued':
      return <Loader2 size={15} />;
  }
}

function updateRecordById(
  records: PassportRecord[],
  id: string,
  updater: (record: PassportRecord) => PassportRecord,
) {
  return records.map((record) => (record.id === id ? updater(record) : record));
}

function getSavedLanguage(): AppLanguage {
  try {
    const saved = window.localStorage.getItem('passport-extractor-language');
    return saved === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

function getSavedDeepScan() {
  try {
    return window.localStorage.getItem('passport-extractor-deep-scan') === 'true';
  } catch {
    return false;
  }
}

function normalizeAngle(angle: number) {
  const normalized = angle % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}

function uniqueAngles(angles: number[]) {
  const seen = new Set<number>();
  return angles.map((angle) => Math.round(normalizeAngle(angle))).filter((angle) => {
    const key = ((angle % 360) + 360) % 360;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getDateParts(value: string) {
  const match = value.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yy, mm, dd] = match;
  const month = Number(mm);
  const day = Number(dd);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { yy: Number(yy), month, day };
}

function isValidDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(year: number, month: number, day: number) {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function normalizeMrzDate(value: string, kind: 'birth' | 'expiry') {
  const parts = getDateParts(value);
  if (!parts) {
    return value;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  const candidates = [currentCentury + parts.yy, currentCentury - 100 + parts.yy, currentCentury + 100 + parts.yy]
    .filter((year) => isValidDate(year, parts.month, parts.day))
    .map((year) => ({
      year,
      date: new Date(Date.UTC(year, parts.month - 1, parts.day)),
    }));

  if (!candidates.length) {
    return value;
  }

  if (kind === 'birth') {
    const oldestAllowed = new Date(Date.UTC(currentYear - 120, now.getMonth(), now.getDate()));
    const validBirths = candidates
      .filter((candidate) => candidate.date <= now && candidate.date >= oldestAllowed)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    const chosen = validBirths[0] ?? candidates.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    return formatDate(chosen.year, parts.month, parts.day);
  }

  const preferred = candidates.find((candidate) => candidate.year === 2000 + parts.yy);
  const futureLimit = new Date(Date.UTC(currentYear + 20, now.getMonth(), now.getDate()));
  const chosen =
    preferred && preferred.date <= futureLimit
      ? preferred
      : candidates
          .filter((candidate) => candidate.date >= now && candidate.date <= futureLimit)
          .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ??
        preferred ??
        candidates.sort((a, b) => b.date.getTime() - a.date.getTime())[0];

  return formatDate(chosen.year, parts.month, parts.day);
}

function getDisplayField(record: PassportRecord, key: FieldKey) {
  if (key === 'birthDate' || key === 'expirationDate') {
    return record.normalizedFields[key] || record.fields[key];
  }

  return record.fields[key];
}

function translateRecordMessage(message: string, t: (key: string) => string) {
  const messageKeys: Record<string, string> = {
    Waiting: 'waiting',
    'Preparing image': 'preparingImage',
    'Checking PDF text': 'tryingEmbeddedText',
    'Reading MRZ': 'readingMrz',
    'Reading visual text': 'readingVisualText',
    'Parsing data': 'parsingData',
    'Manual review': 'manualReview',
    Extracted: 'extracted',
    'Check fields': 'checkFields',
    Failed: 'failed',
  };

  return t(messageKeys[message] ?? message);
}

function translateErrorMessage(message: string, t: (key: string) => string) {
  const errorKeys: Record<string, string> = {
    'No valid TD3 passport MRZ candidate was found.': 'noMrzFound',
    'MRZ was parsed but one or more check fields did not validate.': 'mrzInvalid',
    'Canvas is not available in this browser.': 'canvasUnavailable',
    'Could not render PDF page.': 'pdfRenderFailed',
    'OCR failed.': 'ocrFailed',
    'Select at least one page to import.': 'selectAtLeastOne',
  };

  return t(errorKeys[message] ?? message);
}

function cleanMrzLine(line: string) {
  return line
    .toUpperCase()
    .replace(/[‹›«»<]/g, '<')
    .replace(/[{}[\]()]/g, '<')
    .replace(/[|!]/g, 'I')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<]/g, '');
}

function replaceLikelyFillerRuns(value: string, minLength = 2) {
  return value.replace(new RegExp(`[KCL<]{${minLength},}`, 'g'), (match) => '<'.repeat(match.length));
}

function replaceTrailingLikelyFillers(value: string, minLength = 2) {
  return value.replace(new RegExp(`[KCL<]{${minLength},}$`), (match) => '<'.repeat(match.length));
}

function replaceLikelyNameFillers(value: string) {
  const normalized = replaceTrailingLikelyFillers(value, 3).replace(/<{2,}|KK|CC/g, (match) =>
    '<'.repeat(match.length),
  );

  const bodyWithoutTrailingFillers = normalized.replace(/<+$/, '');

  if (bodyWithoutTrailingFillers.includes('<<')) {
    return normalized;
  }

  return normalized.replace(/([A-Z]{2,})(KK|CC|LL)([A-Z]{2,})/, (_, before: string, match: string, after: string) =>
    `${before}${'<'.repeat(match.length)}${after}`,
  );
}

function toMrzLength(line: string, length = 44) {
  const trimmed = line.slice(0, length);
  return trimmed.padEnd(length, '<');
}

function normalizeFirstMrzLineFillers(line: string) {
  const chars = toMrzLength(line).split('');

  if (chars[0] === 'P' && (chars[1] === 'K' || chars[1] === 'C' || chars[1] === 'L')) {
    chars[1] = '<';
  }

  const prefix = chars.slice(0, 5).join('');
  const names = chars.slice(5).join('');
  const normalizedNames = replaceLikelyNameFillers(names);

  return `${prefix}${normalizedNames}`.slice(0, 44);
}

function normalizeSecondMrzLineFillers(line: string) {
  const padded = toMrzLength(line);
  const documentNumber = replaceTrailingLikelyFillers(padded.slice(0, 9), 2);
  const middle = padded.slice(9, 28);
  const personalNumber = replaceTrailingLikelyFillers(replaceLikelyFillerRuns(padded.slice(28, 42)), 2);
  const checks = padded.slice(42, 44);

  return `${documentNumber}${middle}${personalNumber}${checks}`.slice(0, 44);
}

function expandCandidatePair(pair: string[]) {
  const [firstLine, secondLine] = pair;
  const firstVariants = [firstLine, normalizeFirstMrzLineFillers(firstLine)];
  const secondVariants = [secondLine, normalizeSecondMrzLineFillers(secondLine)];
  const variants: string[][] = [];

  for (const firstVariant of firstVariants) {
    for (const secondVariant of secondVariants) {
      variants.push([firstVariant, secondVariant]);
    }
  }

  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = variant.join('\n');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function findCandidatePairs(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanMrzLine)
    .filter((line) => line.length >= 20);

  const pairs: string[][] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const firstLine = lines[index];
    const secondLine = lines[index + 1];
    const firstStart = Math.max(firstLine.search(/P[<KCL]/), firstLine.search(/^P[A-Z0-9<]/));
    const lineOne = firstStart >= 0 ? firstLine.slice(firstStart) : firstLine;

    if (lineOne.length >= 30 && secondLine.length >= 30) {
      pairs.push([toMrzLength(lineOne), toMrzLength(secondLine)]);
    }
  }

  const compact = lines.join('');
  const compactStart = compact.search(/P[<KCL]/);
  if (compactStart >= 0 && compact.length >= compactStart + 70) {
    const candidate = compact.slice(compactStart, compactStart + 88);
    pairs.push([toMrzLength(candidate.slice(0, 44)), toMrzLength(candidate.slice(44, 88))]);
  }

  const seen = new Set<string>();
  return pairs.flatMap(expandCandidatePair).filter((pair) => {
    const key = pair.join('\n');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreParseResult(result: ParseResult) {
  const validDetails = result.details.filter((detail) => detail.valid).length;
  const invalidDetails = result.details.length - validDetails;
  const documentNumberScore = result.documentNumber ? 20 : 0;
  const passportFormatScore = result.format === 'TD3' ? 25 : 0;
  const validScore = result.valid ? 100 : 0;
  return validScore + passportFormatScore + documentNumberScore + validDetails - invalidDetails * 3;
}

function scoreMrzLineQuality(lines: string[]) {
  const [firstLine, secondLine] = lines;
  let score = 0;

  if (firstLine[1] === '<') {
    score += 3;
  }

  if (firstLine.slice(5).includes('<<')) {
    score += 4;
  }

  const firstTrailingFillers = firstLine.match(/<+$/)?.[0].length ?? 0;
  score += Math.min(8, firstTrailingFillers);

  if (/[KCL]{3,}$/.test(firstLine)) {
    score -= 6;
  }

  if (/[KCL<]{2,}$/.test(secondLine.slice(0, 9))) {
    score += 2;
  }

  const personalNumber = secondLine.slice(28, 42);
  const personalFillers = personalNumber.match(/<+$/)?.[0].length ?? 0;
  score += Math.min(6, personalFillers);

  if (/[KCL]{2,}/.test(personalNumber)) {
    score -= 4;
  }

  return score;
}

function parseBestMrz(ocrText: string): ParsedCandidate | null {
  const candidates = findCandidatePairs(ocrText);
  let bestCandidate: ParsedCandidate | null = null;

  for (const lines of candidates) {
    try {
      const result = parse(lines, { autocorrect: true });
      const score = scoreParseResult(result) + scoreMrzLineQuality(lines);
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { result, lines, score, candidateCount: candidates.length };
      }
    } catch {
      // Unsupported candidates are expected with imperfect OCR.
    }
  }

  return bestCandidate;
}

function extractedFieldsFromParse(result: ParseResult): ExtractedFields {
  const fields = result.fields;

  return {
    passportNumber: result.documentNumber ?? fields.documentNumber ?? '',
    documentCode: fields.documentCode ?? '',
    issuingState: fields.issuingState ?? '',
    nationality: fields.nationality ?? '',
    lastName: fields.lastName ?? '',
    firstNames: fields.firstName ?? '',
    birthDate: fields.birthDate ?? '',
    sex: fields.sex ?? '',
    expirationDate: fields.expirationDate ?? '',
    personalNumber: fields.personalNumber ?? '',
  };
}

function normalizedFieldsFromExtracted(fields: ExtractedFields): NormalizedFields {
  return {
    birthDate: normalizeMrzDate(fields.birthDate, 'birth'),
    expirationDate: normalizeMrzDate(fields.expirationDate, 'expiry'),
  };
}

const requiredTravelFields: FieldKey[] = [
  'passportNumber',
  'lastName',
  'firstNames',
  'birthDate',
  'sex',
  'expirationDate',
  'nationality',
];

const fieldLabelKeysByField = fieldLabels.reduce<Record<FieldKey, string>>((labels, field) => {
  labels[field.key] = field.labelKey;
  return labels;
}, {} as Record<FieldKey, string>);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseTravelDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);

  if (!isValidDate(year, month, day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function getAiFieldValue(record: PassportRecord, key: FieldKey) {
  return getDisplayField(record, key).trim();
}

function getParsedSuggestionValue(fields: ExtractedFields, normalizedFields: NormalizedFields, key: FieldKey) {
  if (key === 'birthDate' || key === 'expirationDate') {
    return normalizedFields[key] || fields[key];
  }

  return fields[key];
}

function buildMrzFieldSuggestions(record: PassportRecord): AiSuggestion[] {
  const sourceText = [record.rawMrz, record.ocrText, record.embeddedText].filter(Boolean).join('\n');
  if (!sourceText.trim()) {
    return [];
  }

  const parsed = parseBestMrz(sourceText);
  if (!parsed) {
    return [];
  }

  const fields = extractedFieldsFromParse(parsed.result);
  const normalizedFields = normalizedFieldsFromExtracted(fields);
  const confidence = parsed.result.valid ? 98 : clamp(Math.round(68 + parsed.score / 3), 68, 92);

  return fieldLabels.flatMap((field) => {
    const suggestedValue = getParsedSuggestionValue(fields, normalizedFields, field.key).trim();
    const currentValue = getAiFieldValue(record, field.key);

    if (!suggestedValue || currentValue === suggestedValue) {
      return [];
    }

    return [
      {
        id: `${field.key}-${suggestedValue}`,
        field: field.key,
        labelKey: field.labelKey,
        suggestedValue,
        currentValue,
        reasonKey: 'aiUseMrzSuggestion',
        confidence,
      },
    ];
  });
}

function buildAiReview(record: PassportRecord): AiReview {
  const issues: AiIssue[] = [];
  const suggestions = buildMrzFieldSuggestions(record);
  const missingFields = requiredTravelFields.filter((key) => !getAiFieldValue(record, key));
  const invalidDetails = record.validationDetails.filter((detail) => !detail.valid);
  const passportNumber = getAiFieldValue(record, 'passportNumber');
  const birthDate = getAiFieldValue(record, 'birthDate');
  const expirationDate = getAiFieldValue(record, 'expirationDate');
  const parsedBirthDate = birthDate ? parseTravelDate(birthDate) : null;
  const parsedExpirationDate = expirationDate ? parseTravelDate(expirationDate) : null;
  const now = new Date();

  if (!passportNumber) {
    issues.push({ id: 'missing-passport-number', severity: 'critical', messageKey: 'aiMissingPassportNumber' });
  } else if (!/^[A-Z0-9]{6,12}$/i.test(passportNumber)) {
    issues.push({ id: 'unusual-passport-number', severity: 'warning', messageKey: 'aiUnusualPassportNumber' });
  }

  if (missingFields.length > 1 || (missingFields.length === 1 && missingFields[0] !== 'passportNumber')) {
    issues.push({
      id: 'missing-required-fields',
      severity: 'critical',
      messageKey: 'aiMissingRequiredFields',
      detail: missingFields.map((key) => fieldLabelKeysByField[key]).join(', '),
    });
  }

  if (invalidDetails.length) {
    issues.push({
      id: 'invalid-check-digits',
      severity: 'warning',
      messageKey: 'aiInvalidCheckDigits',
      detail: String(invalidDetails.length),
    });
  }

  if (birthDate && !parsedBirthDate) {
    issues.push({ id: 'invalid-birth-date', severity: 'critical', messageKey: 'aiInvalidBirthDate' });
  }

  if (parsedBirthDate) {
    const ageYears = (now.getTime() - parsedBirthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 0 || ageYears > 120) {
      issues.push({ id: 'invalid-birth-age', severity: 'critical', messageKey: 'aiInvalidBirthDate' });
    }
  }

  if (parsedExpirationDate) {
    const daysUntilExpiry = (parsedExpirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysUntilExpiry < 0) {
      issues.push({ id: 'expired-passport', severity: 'critical', messageKey: 'aiExpiredPassport' });
    } else if (daysUntilExpiry <= 180) {
      issues.push({ id: 'expiring-soon', severity: 'warning', messageKey: 'aiExpiringSoon' });
    }
  }

  if (!record.rawMrz && !record.ocrText && ['done', 'needs-review', 'error'].includes(record.status)) {
    issues.push({ id: 'no-mrz-text', severity: 'critical', messageKey: 'aiNoMrzText' });
  }

  if (/[\u0400-\u04FF]/.test(record.visualOcrText)) {
    issues.push({ id: 'foreign-visual-text', severity: 'good', messageKey: 'aiForeignTextFound' });
  }

  if (
    record.extractionAttempt &&
    normalizeAngle(record.extractionAttempt.rotation - record.rotationAngle) !== 0
  ) {
    issues.push({
      id: 'rotation-mismatch',
      severity: 'warning',
      messageKey: 'aiRotationMismatch',
      detail: `${record.extractionAttempt.rotation} deg`,
    });
  }

  if (record.extractionAttempt && record.extractionAttempt.score < 80 && record.valid !== true) {
    issues.push({ id: 'low-ocr-confidence', severity: 'warning', messageKey: 'aiLowOcrConfidence' });
  }

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  let confidence =
    record.valid === true
      ? 94
      : record.status === 'needs-review'
        ? 60
        : record.status === 'error'
          ? 24
          : record.status === 'processing'
            ? 42
            : 35;

  confidence += record.extractionAttempt ? clamp(Math.round((record.extractionAttempt.score - 100) / 8), -10, 8) : 0;
  confidence += record.visualOcrText ? 2 : 0;
  confidence -= missingFields.length * 5;
  confidence -= invalidDetails.length * 3;
  confidence -= criticalCount * 10;
  confidence -= warningCount * 5;
  confidence -= suggestions.length ? Math.min(14, suggestions.length * 3) : 0;
  if (criticalCount) {
    confidence = Math.min(confidence, 54);
  } else if (warningCount) {
    confidence = Math.min(confidence, 84);
  }
  confidence = clamp(Math.round(confidence), 0, 99);

  const summaryKey =
    confidence >= 85 && criticalCount === 0
      ? 'aiSummaryStrong'
      : confidence >= 55 && criticalCount <= 1
        ? 'aiSummaryReview'
        : 'aiSummaryManual';

  return { confidence, summaryKey, issues, suggestions };
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getRotatedDimensions(width: number, height: number, angle: number) {
  const radians = (Math.abs(angle) * Math.PI) / 180;
  return {
    width: Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)),
    height: Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)),
  };
}

async function renderSourceCanvas(file: File, rotationAngle = 0, maxWidth = 2200) {
  const bitmap = await createImageBitmap(file);
  const normalizedRotation = normalizeAngle(rotationAngle);
  const dimensions = getRotatedDimensions(bitmap.width, bitmap.height, normalizedRotation);
  const scale = Math.min(2.2, Math.max(1, maxWidth / dimensions.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  context.drawImage(bitmap, (-bitmap.width * scale) / 2, (-bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  bitmap.close();

  return canvas;
}

function applyPreprocessing(canvas: HTMLCanvasElement, variant: (typeof mrzVariants)[number]) {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const average = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrasted =
      variant === 'binary'
        ? average > 160
          ? 255
          : 0
        : average < 150
          ? Math.max(0, average - 52)
          : Math.min(255, average + 68);
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);
}

async function preprocessMrzImage(
  file: File,
  rotationAngle = 0,
  cropBand = mrzCropBands[0],
  variant: (typeof mrzVariants)[number] = 'contrast',
) {
  const sourceCanvas = await renderSourceCanvas(file, rotationAngle);
  const cropY = Math.round(sourceCanvas.height * cropBand.start);
  const cropHeight = Math.max(1, Math.round(sourceCanvas.height * (cropBand.end - cropBand.start)));
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = cropHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, cropY, sourceCanvas.width, cropHeight, 0, 0, canvas.width, canvas.height);
  applyPreprocessing(canvas, variant);

  return canvas;
}

async function preprocessVisualImage(file: File, rotationAngle = 0) {
  const canvas = await renderSourceCanvas(file, rotationAngle, 1800);
  applyPreprocessing(canvas, 'contrast');
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not render PDF page.'));
        }
      },
      type,
      quality,
    );
  });
}

function getPdfPageCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  return { canvas, context };
}

function getPageImageName(fileName: string, pageNumber: number) {
  const baseName = fileName.replace(/\.pdf$/i, '') || 'passport';
  return `${baseName}-page-${pageNumber}.png`;
}

async function getPdfPageText(page: pdfjsLib.PDFPageProxy) {
  try {
    const textContent = await page.getTextContent();
    return textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

async function renderPdfThumbnails(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const document = await loadingTask.promise;
  const pages: PdfPageOption[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(0.42, 220 / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const { canvas, context } = getPdfPageCanvas(viewport.width, viewport.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({
        pageNumber,
        thumbnailUrl: canvas.toDataURL('image/jpeg', 0.78),
        selected: true,
        width: Math.round(baseViewport.width),
        height: Math.round(baseViewport.height),
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}

async function renderPdfPagesToFiles(file: File, pageNumbers: number[]): Promise<RenderedPdfPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const document = await loadingTask.promise;
  const renderedPages: RenderedPdfPage[] = [];

  try {
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(1.7, 1800 / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const { canvas, context } = getPdfPageCanvas(viewport.width, viewport.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasToBlob(canvas);
      const embeddedText = await getPdfPageText(page);
      renderedPages.push({
        file: new File([blob], getPageImageName(file.name, pageNumber), { type: 'image/png' }),
        sourceFileName: `${file.name || 'passport.pdf'} - page ${pageNumber}`,
        embeddedText,
      });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return renderedPages;
}

function recordToExport(record: PassportRecord) {
  const aiReview = buildAiReview(record);

  return {
    id: record.id,
    sourceFileName: record.sourceFileName,
    status: record.status,
    fields: record.fields,
    normalizedFields: record.normalizedFields,
    rawMrz: record.rawMrz,
    valid: record.valid,
    rotationAngle: record.rotationAngle,
    extractionAttempt: record.extractionAttempt,
    validationDetails: record.validationDetails.map((detail) => ({
      label: detail.label,
      field: detail.field,
      value: detail.value,
      valid: detail.valid,
      error: detail.error ?? '',
    })),
    ocrText: record.ocrText,
    visualOcrText: record.visualOcrText,
    aiReview,
    error: record.error,
  };
}

function buildCsv(records: PassportRecord[]) {
  const headers = [
    'sourceFileName',
    'status',
    'passportNumber',
    'documentCode',
    'issuingState',
    'nationality',
    'lastName',
    'firstNames',
    'birthDate',
    'birthDateFormatted',
    'sex',
    'expirationDate',
    'expirationDateFormatted',
    'personalNumber',
    'valid',
    'aiConfidence',
    'aiIssues',
    'aiSuggestions',
    'rawMrz',
    'visualOcrText',
  ];

  const rows = records.map((record) => {
    const aiReview = buildAiReview(record);

    return [
      record.sourceFileName,
      record.status,
      record.fields.passportNumber,
      record.fields.documentCode,
      record.fields.issuingState,
      record.fields.nationality,
      record.fields.lastName,
      record.fields.firstNames,
      record.fields.birthDate,
      record.normalizedFields.birthDate,
      record.fields.sex,
      record.fields.expirationDate,
      record.normalizedFields.expirationDate,
      record.fields.personalNumber,
      record.valid ?? '',
      aiReview.confidence,
      aiReview.issues.map((issue) => `${issue.messageKey}${issue.detail ? `: ${issue.detail}` : ''}`).join('; '),
      aiReview.suggestions
        .map((suggestion) => `${suggestion.labelKey}: ${suggestion.currentValue} -> ${suggestion.suggestedValue}`)
        .join('; '),
      record.rawMrz,
      record.visualOcrText,
    ];
  });

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

async function copyText(text: string) {
  if (!text) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose Clipboard API but deny write access.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

function App() {
  const [language, setLanguage] = useState<AppLanguage>(getSavedLanguage);
  const [isDeepScan, setIsDeepScan] = useState(getSavedDeepScan);
  const [records, setRecords] = useState<PassportRecord[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState('');
  const [workerState, setWorkerState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [pdfDialog, setPdfDialog] = useState<PdfDialogState | null>(null);
  const [pdfImportMessage, setPdfImportMessage] = useState('');
  const [isImportingPdf, setIsImportingPdf] = useState(false);
  const [visualOcrRecordIds, setVisualOcrRecordIds] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);
  const visualWorkerRef = useRef<Tesseract.Worker | null>(null);
  const activeRecordIdRef = useRef<string | null>(null);
  const processingChainRef = useRef(Promise.resolve());
  const recordsRef = useRef<PassportRecord[]>([]);
  const pdfDialogRef = useRef<PdfDialogState | null>(null);
  const pdfQueueRef = useRef<File[]>([]);
  const isLoadingPdfRef = useRef(false);

  const stats = useMemo(() => {
    const processed = records.filter((record) => ['done', 'needs-review', 'error'].includes(record.status)).length;
    const valid = records.filter((record) => record.status === 'done').length;
    const review = records.filter((record) => record.status === 'needs-review' || record.status === 'error').length;
    return { processed, valid, review, total: records.length };
  }, [records]);

  const t = (key: string) => {
    const currentDictionary: Record<string, string> = translations[language];
    const fallbackDictionary: Record<string, string> = translations.en;
    return currentDictionary[key] ?? fallbackDictionary[key] ?? key;
  };

  function toggleLanguage() {
    setLanguage((current) => {
      const next = current === 'en' ? 'ru' : 'en';
      try {
        window.localStorage.setItem('passport-extractor-language', next);
      } catch {
        // Language preference is optional.
      }
      return next;
    });
  }

  function toggleDeepScan() {
    setIsDeepScan((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('passport-extractor-deep-scan', String(next));
      } catch {
        // Deep Scan preference is optional.
      }
      return next;
    });
  }

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    document.title = translations[language].appTitle;
  }, [language]);

  useEffect(() => {
    pdfDialogRef.current = pdfDialog;
  }, [pdfDialog]);

  useEffect(() => {
    return () => {
      recordsRef.current.forEach((record) => URL.revokeObjectURL(record.previewUrl));
      pdfDialogRef.current?.pages.forEach((page) => URL.revokeObjectURL(page.thumbnailUrl));
      void workerRef.current?.terminate();
      void visualWorkerRef.current?.terminate();
    };
  }, []);

  function setRecord(id: string, updater: (record: PassportRecord) => PassportRecord) {
    setRecords((current) => updateRecordById(current, id, updater));
  }

  async function ensureWorker() {
    if (workerRef.current) {
      return workerRef.current;
    }

    setWorkerState('loading');
    const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
      logger: (message) => {
        const id = activeRecordIdRef.current;
        if (!id || message.status !== 'recognizing text') {
          return;
        }
        setRecord(id, (record) => ({
          ...record,
          progress: Math.max(record.progress, Math.round(30 + message.progress * 55)),
          message: 'Reading MRZ',
        }));
      },
    });
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '0',
      user_defined_dpi: '300',
    });
    workerRef.current = worker;
    setWorkerState('ready');
    return worker;
  }

  async function ensureVisualWorker() {
    if (visualWorkerRef.current) {
      return visualWorkerRef.current;
    }

    const worker = await Tesseract.createWorker('eng+rus', Tesseract.OEM.LSTM_ONLY);
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    visualWorkerRef.current = worker;
    return worker;
  }

  function buildMrzAttempts(rotationAngle: number, deepScan: boolean) {
    const selected = normalizeAngle(rotationAngle);
    const angles = uniqueAngles([selected, selected + 90, selected + 180, selected + 270]);
    const attempts: Array<{
      rotation: number;
      crop: (typeof mrzCropBands)[number];
      variant: (typeof mrzVariants)[number];
    }> = [];

    if (!deepScan) {
      attempts.push({ rotation: selected, crop: mrzCropBands[1], variant: 'contrast' });
      attempts.push({ rotation: selected, crop: mrzCropBands[0], variant: 'contrast' });
      attempts.push({ rotation: selected, crop: mrzCropBands[1], variant: 'binary' });

      for (const rotation of angles.filter((angle) => angle !== selected)) {
        attempts.push({ rotation, crop: mrzCropBands[1], variant: 'contrast' });
      }

      return attempts;
    }

    for (const crop of mrzCropBands) {
      for (const variant of mrzVariants) {
        attempts.push({ rotation: selected, crop, variant });
      }
    }

    for (const rotation of angles.filter((angle) => angle !== selected)) {
      attempts.push({ rotation, crop: mrzCropBands[0], variant: 'contrast' });
      attempts.push({ rotation, crop: mrzCropBands[1], variant: 'binary' });
    }

    return attempts;
  }

  async function runMrzExtraction(
    record: PassportRecord,
    getWorker: () => Promise<Tesseract.Worker>,
    deepScan: boolean,
  ) {
    const attempts = buildMrzAttempts(record.rotationAngle, deepScan);
    let bestParsed: ParsedCandidate | null = record.embeddedText ? parseBestMrz(record.embeddedText) : null;
    let bestText = record.embeddedText;
    let bestAttempt: ExtractionAttempt | null = bestParsed
      ? {
          rotation: record.rotationAngle,
          crop: 'pdf-text',
          variant: 'embedded',
          score: bestParsed.score,
          candidateCount: bestParsed.candidateCount,
      }
      : null;

    if (bestParsed?.result.valid) {
      return { parsed: bestParsed, ocrText: bestText, attempt: bestAttempt };
    }

    const worker = await getWorker();

    for (const [index, attempt] of attempts.entries()) {
      setRecord(record.id, (current) => ({
        ...current,
        progress: Math.max(current.progress, Math.round(24 + (index / attempts.length) * 52)),
        message: 'Reading MRZ',
      }));

      const canvas = await preprocessMrzImage(record.file, attempt.rotation, attempt.crop, attempt.variant);
      const recognition = await worker.recognize(canvas, { rotateAuto: true });
      const ocrText = recognition.data.text;
      const parsed = parseBestMrz(ocrText);

      if (parsed && (!bestParsed || parsed.score > bestParsed.score)) {
        bestParsed = parsed;
        bestText = ocrText;
        bestAttempt = {
          rotation: attempt.rotation,
          crop: attempt.crop.name,
          variant: attempt.variant,
          score: parsed.score,
          candidateCount: parsed.candidateCount,
        };
      } else if (!bestText && ocrText.trim()) {
        bestText = ocrText;
      }

      if (bestParsed?.result.valid) {
        break;
      }
    }

    return { parsed: bestParsed, ocrText: bestText, attempt: bestAttempt };
  }

  async function runVisualOcr(record: PassportRecord) {
    try {
      const worker = await ensureVisualWorker();
      const canvas = await preprocessVisualImage(record.file, record.rotationAngle);
      const recognition = await worker.recognize(canvas, { rotateAuto: true });
      return recognition.data.text.trim();
    } catch {
      return '';
    }
  }

  async function processRecord(record: PassportRecord) {
    activeRecordIdRef.current = record.id;
    setRecord(record.id, (current) => ({
      ...current,
      status: 'processing',
      progress: 6,
      message: 'Preparing image',
      error: '',
      ocrText: '',
      rawMrz: '',
      visualOcrText: '',
      extractionAttempt: null,
      valid: null,
      validationDetails: [],
    }));

    try {
      setRecord(record.id, (current) => ({
        ...current,
        progress: 18,
        message: record.embeddedText ? 'Checking PDF text' : 'Reading MRZ',
      }));
      const extraction = await runMrzExtraction(record, ensureWorker, isDeepScan);

      setRecord(record.id, (current) => ({
        ...current,
        progress: 92,
        message: 'Parsing data',
        ocrText: extraction.ocrText,
        extractionAttempt: extraction.attempt,
      }));
      const parsed = extraction.parsed;

      if (!parsed) {
        setRecord(record.id, (current) => ({
          ...current,
          status: 'needs-review',
          progress: 100,
          message: 'Manual review',
          ocrText: extraction.ocrText,
          extractionAttempt: extraction.attempt,
          valid: false,
          error: 'No valid TD3 passport MRZ candidate was found.',
        }));
        return;
      }

      const validationDetails = parsed.result.details;
      const fields = extractedFieldsFromParse(parsed.result);
      setRecord(record.id, (current) => ({
        ...current,
        status: parsed.result.valid ? 'done' : 'needs-review',
        progress: 100,
        message: parsed.result.valid ? 'Extracted' : 'Check fields',
        fields,
        normalizedFields: normalizedFieldsFromExtracted(fields),
        rawMrz: parsed.lines.join('\n'),
        valid: parsed.result.valid,
        validationDetails,
        ocrText: extraction.ocrText,
        extractionAttempt: extraction.attempt,
        error: parsed.result.valid ? '' : 'MRZ was parsed but one or more check fields did not validate.',
      }));
    } catch (error) {
      setRecord(record.id, (current) => ({
        ...current,
        status: 'error',
        progress: 100,
        message: 'Failed',
        valid: false,
        error: error instanceof Error ? error.message : 'OCR failed.',
      }));
    } finally {
      activeRecordIdRef.current = null;
    }
  }

  async function readVisualText(record: PassportRecord) {
    if (visualOcrRecordIds.has(record.id)) {
      return;
    }

    setVisualOcrRecordIds((current) => new Set(current).add(record.id));
    try {
      const visualOcrText = await runVisualOcr(record);
      setRecord(record.id, (current) => ({
        ...current,
        visualOcrText,
      }));
    } catch {
      setCopiedLabel(t('ocrFailed'));
      window.setTimeout(() => setCopiedLabel(''), 1400);
    } finally {
      setVisualOcrRecordIds((current) => {
        const next = new Set(current);
        next.delete(record.id);
        return next;
      });
    }
  }

  function queueRecords(nextRecords: PassportRecord[]) {
    processingChainRef.current = processingChainRef.current
      .then(async () => {
        for (const record of nextRecords) {
          await processRecord(record);
        }
      })
      .catch(() => undefined);
  }

  async function loadNextPdfFromQueue() {
    if (isLoadingPdfRef.current || pdfDialogRef.current) {
      return;
    }

    const file = pdfQueueRef.current.shift();
    if (!file) {
      setPdfImportMessage('');
      return;
    }

    isLoadingPdfRef.current = true;
    setPdfImportMessage(`${t('preparingPdf')}: ${file.name || 'PDF'}`);
    let shouldContinueQueue = false;

    try {
      const pages = await renderPdfThumbnails(file);
      const nextDialog: PdfDialogState = {
        id: crypto.randomUUID(),
        file,
        fileName: file.name || 'passport.pdf',
        pages,
        error: '',
      };
      pdfDialogRef.current = nextDialog;
      setPdfDialog(nextDialog);
      setPdfImportMessage('');
    } catch (error) {
      setCopiedLabel(error instanceof Error ? `${t('pdfFailed')}: ${error.message}` : t('pdfFailed'));
      window.setTimeout(() => setCopiedLabel(''), 2500);
      setPdfImportMessage('');
      shouldContinueQueue = true;
    } finally {
      isLoadingPdfRef.current = false;
      if (shouldContinueQueue) {
        void loadNextPdfFromQueue();
      }
    }
  }

  function enqueuePdfFiles(files: File[]) {
    pdfQueueRef.current.push(...files);
    void loadNextPdfFromQueue();
  }

  function closePdfDialog() {
    pdfDialogRef.current?.pages.forEach((page) => URL.revokeObjectURL(page.thumbnailUrl));
    pdfDialogRef.current = null;
    setPdfDialog(null);
    setPdfImportMessage('');
    window.setTimeout(() => {
      void loadNextPdfFromQueue();
    }, 0);
  }

  function togglePdfPage(pageNumber: number) {
    setPdfDialog((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        error: '',
        pages: current.pages.map((page) =>
          page.pageNumber === pageNumber ? { ...page, selected: !page.selected } : page,
        ),
      };
    });
  }

  function setAllPdfPages(selected: boolean) {
    setPdfDialog((current) =>
      current
        ? {
            ...current,
            error: '',
            pages: current.pages.map((page) => ({ ...page, selected })),
          }
        : current,
    );
  }

  async function importSelectedPdfPages() {
    if (!pdfDialog) {
      return;
    }

    const selectedPages = pdfDialog.pages.filter((page) => page.selected).map((page) => page.pageNumber);

    if (!selectedPages.length) {
      setPdfDialog((current) => (current ? { ...current, error: 'Select at least one page to import.' } : current));
      return;
    }

    setIsImportingPdf(true);
    setPdfImportMessage(`${t('rendering')} ${selectedPages.length}`);

    try {
      const renderedPages = await renderPdfPagesToFiles(pdfDialog.file, selectedPages);
      const nextRecords = renderedPages.map((page) => createRecord(page.file, page.sourceFileName, page.embeddedText));

      if (nextRecords.length) {
        setRecords((current) => [...nextRecords, ...current]);
        queueRecords(nextRecords);
      }

      closePdfDialog();
    } catch (error) {
      setPdfDialog((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : 'Could not render selected PDF pages.',
            }
          : current,
      );
    } finally {
      setIsImportingPdf(false);
      setPdfImportMessage('');
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const imageFiles = files.filter(isAcceptedImage);
    const pdfFiles = files.filter((file) => !isAcceptedImage(file) && isAcceptedPdf(file));
    const nextRecords = imageFiles.map((file) => createRecord(file));

    if (!nextRecords.length && !pdfFiles.length) {
      setCopiedLabel(t('unsupportedFile'));
      window.setTimeout(() => setCopiedLabel(''), 1800);
      return;
    }

    if (nextRecords.length) {
      setRecords((current) => [...nextRecords, ...current]);
      queueRecords(nextRecords);
    }

    if (pdfFiles.length) {
      enqueuePdfFiles(pdfFiles);
    }
  }

  function retryRecord(record: PassportRecord) {
    const retryVersion: PassportRecord = {
      ...record,
      status: 'queued',
      progress: 0,
      message: 'Waiting',
      fields: { ...emptyFields },
      normalizedFields: { ...emptyNormalizedFields },
      rawMrz: '',
      valid: null,
      validationDetails: [],
      ocrText: '',
      visualOcrText: '',
      extractionAttempt: null,
      error: '',
    };
    setRecords((current) => updateRecordById(current, record.id, () => retryVersion));
    queueRecords([retryVersion]);
  }

  function removeRecord(record: PassportRecord) {
    URL.revokeObjectURL(record.previewUrl);
    setRecords((current) => current.filter((item) => item.id !== record.id));
  }

  function clearAll() {
    records.forEach((record) => URL.revokeObjectURL(record.previewUrl));
    setRecords([]);
  }

  function updateField(recordId: string, key: FieldKey, value: string) {
    setRecord(recordId, (record) => ({
      ...record,
      fields: {
        ...record.fields,
        ...(key === 'birthDate' || key === 'expirationDate' ? {} : { [key]: value }),
      },
      normalizedFields: {
        ...record.normalizedFields,
        ...(key === 'birthDate' || key === 'expirationDate' ? { [key]: value } : {}),
      },
    }));
  }

  function applyAiSuggestion(recordId: string, suggestion: AiSuggestion) {
    updateField(recordId, suggestion.field, suggestion.suggestedValue);
  }

  function applyAllAiSuggestions(record: PassportRecord, suggestions: AiSuggestion[]) {
    const eligibleSuggestions = suggestions.filter((suggestion) => suggestion.confidence >= 70);
    if (!eligibleSuggestions.length) {
      return;
    }

    setRecord(record.id, (current) =>
      eligibleSuggestions.reduce(
        (updatedRecord, suggestion) => ({
          ...updatedRecord,
          fields: {
            ...updatedRecord.fields,
            ...(suggestion.field === 'birthDate' || suggestion.field === 'expirationDate'
              ? {}
              : { [suggestion.field]: suggestion.suggestedValue }),
          },
          normalizedFields: {
            ...updatedRecord.normalizedFields,
            ...(suggestion.field === 'birthDate' || suggestion.field === 'expirationDate'
              ? { [suggestion.field]: suggestion.suggestedValue }
              : {}),
          },
        }),
        current,
      ),
    );
  }

  function updateRotation(recordId: string, angle: number) {
    setRecord(recordId, (record) => ({
      ...record,
      rotationAngle: normalizeAngle(angle),
    }));
  }

  function updateZoom(recordId: string, delta: number) {
    setRecord(recordId, (record) => ({
      ...record,
      previewZoom: Math.min(3, Math.max(0.6, Number((record.previewZoom + delta).toFixed(2)))),
    }));
  }

  function startRotationDrag(record: PassportRecord, event: ReactPointerEvent<HTMLButtonElement>) {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const updateFromPoint = (clientX: number, clientY: number) => {
      const degrees = (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI + 90;
      updateRotation(record.id, Math.round(degrees));
    };

    updateFromPoint(event.clientX, event.clientY);
    element.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => updateFromPoint(moveEvent.clientX, moveEvent.clientY);
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  async function copyValue(label: string, value: string) {
    try {
      await copyText(value);
      setCopiedLabel(`${label} ${t('copied')}`);
      window.setTimeout(() => setCopiedLabel(''), 1400);
    } catch {
      setCopiedLabel(t('copyFailed'));
      window.setTimeout(() => setCopiedLabel(''), 1400);
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(records.map(recordToExport), null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    downloadBlob('passports.json', blob);
  }

  function exportCsv() {
    const blob = new Blob([buildCsv(records)], {
      type: 'text/csv;charset=utf-8',
    });
    downloadBlob('passports.csv', blob);
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Passport extractor controls">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>{t('appTitle')}</h1>
            <p>{t('subtitle')}</p>
          </div>
        </div>

        <div className="actions">
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*,application/pdf,.pdf"
            multiple
            onChange={(event) => {
              if (event.target.files) {
                addFiles(event.target.files);
                event.target.value = '';
              }
            }}
          />
          <input
            ref={cameraInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              if (event.target.files) {
                addFiles(event.target.files);
                event.target.value = '';
              }
            }}
          />
          <button className="button primary" type="button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={17} />
            {t('upload')}
          </button>
          <button className="button" type="button" onClick={() => cameraInputRef.current?.click()}>
            <Camera size={17} />
            {t('camera')}
          </button>
          <button
            className={`button ${isDeepScan ? 'active' : ''}`}
            type="button"
            onClick={toggleDeepScan}
            title={isDeepScan ? t('deepScanHint') : t('fastModeHint')}
          >
            <Sparkles size={17} />
            {isDeepScan ? t('deepScanMode') : t('fastMode')}
          </button>
          <button className="button" type="button" onClick={exportJson} disabled={!records.length}>
            <FileJson size={17} />
            {t('json')}
          </button>
          <button className="button" type="button" onClick={exportCsv} disabled={!records.length}>
            <Download size={17} />
            {t('csv')}
          </button>
          <button className="button" type="button" onClick={toggleLanguage} title="Language">
            <Languages size={17} />
            {t('languageToggle')}
          </button>
          <button className="icon-button danger" type="button" onClick={clearAll} disabled={!records.length} title={t('clearAll')}>
            <Trash2 size={18} />
          </button>
        </div>
      </section>

      <section
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <ImagePlus size={24} />
        <div>
          <strong>{t('dropTitle')}</strong>
          <span>{t('dropFormats')}</span>
        </div>
        <div className="stats">
          <span>
            {stats.total} {t('total')}
          </span>
          <span>
            {stats.valid} {t('valid')}
          </span>
          <span>
            {stats.review} {t('review')}
          </span>
          <span>
            {pdfImportMessage ||
              (workerState === 'loading' ? t('ocrLoading') : workerState === 'ready' ? t('ocrReady') : t('ocrIdle'))}
          </span>
        </div>
      </section>

      {records.length === 0 ? (
        <section className="empty-state">
          <Clipboard size={30} />
          <h2>{t('noPassports')}</h2>
          <p>{t('emptyHint')}</p>
        </section>
      ) : (
        <section className="record-list" aria-label="Imported passports and extracted data">
          {records.map((record) => {
            const aiReview = buildAiReview(record);

            return (
            <article className="record-card" key={record.id}>
              <div className="passport-panel">
                <div className="record-header">
                  <div>
                    <h2>{record.sourceFileName}</h2>
                    <p>{translateRecordMessage(record.message, t)}</p>
                  </div>
                  <span className={`status-pill ${record.status}`}>
                    {getStatusIcon(record.status)}
                    {statusLabel(record.status, t)}
                  </span>
                </div>
                <div className="image-frame">
                  <div className="image-rotator" style={{ transform: `rotate(${record.rotationAngle}deg)` }}>
                    <img
                      src={record.previewUrl}
                      alt={`Imported passport ${record.sourceFileName}`}
                      style={{ width: `${Math.round(record.previewZoom * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="record-tools">
                  <button className="button compact" type="button" onClick={() => retryRecord(record)}>
                    <RefreshCcw size={15} />
                    {t('retry')}
                  </button>
                  <button className="button compact" type="button" onClick={() => retryRecord(record)}>
                    <Search size={15} />
                    {t('reextract')}
                  </button>
                  <button
                    className="button compact"
                    type="button"
                    onClick={() => readVisualText(record)}
                    disabled={visualOcrRecordIds.has(record.id)}
                  >
                    {visualOcrRecordIds.has(record.id) ? <Loader2 size={15} className="spin" /> : <Languages size={15} />}
                    {visualOcrRecordIds.has(record.id) ? t('visualOcrRunning') : t('visualOcrButton')}
                  </button>
                  <button className="icon-button" type="button" onClick={() => updateRotation(record.id, record.rotationAngle - 90)} title={t('rotateLeft')}>
                    <RotateCcw size={16} />
                  </button>
                  <button className="icon-button" type="button" onClick={() => updateRotation(record.id, record.rotationAngle + 90)} title={t('rotateRight')}>
                    <RotateCw size={16} />
                  </button>
                  <button className="button compact" type="button" onClick={() => updateRotation(record.id, record.rotationAngle + 180)}>
                    {t('rotateHalf')}
                  </button>
                  <button className="button compact" type="button" onClick={() => updateRotation(record.id, 0)}>
                    {t('reset')}
                  </button>
                  <button className="icon-button" type="button" onClick={() => updateZoom(record.id, -0.2)} title={t('zoomOut')}>
                    <ZoomOut size={16} />
                  </button>
                  <button className="icon-button" type="button" onClick={() => updateZoom(record.id, 0.2)} title={t('zoomIn')}>
                    <ZoomIn size={16} />
                  </button>
                  <button
                    className="rotation-dial"
                    type="button"
                    onPointerDown={(event) => startRotationDrag(record, event)}
                    title={t('dragToRotate')}
                  >
                    <span style={{ transform: `rotate(${record.rotationAngle}deg)` }} />
                    <strong>{Math.round(record.rotationAngle)}°</strong>
                  </button>
                  <button className="button compact danger-text" type="button" onClick={() => removeRecord(record)}>
                    <Trash2 size={15} />
                    {t('remove')}
                  </button>
                </div>
              </div>

              <div className="data-panel">
                <div className="progress-line" aria-hidden={record.status !== 'processing'}>
                  <div style={{ width: `${record.progress}%` }} />
                </div>

                <div className="field-grid">
                  {fieldLabels.map((field) => (
                    <label className={`field ${field.prominent ? 'prominent' : ''}`} key={field.key}>
                      <span>{t(field.labelKey)}</span>
                      <div className="input-shell">
                        <input
                          value={getDisplayField(record, field.key)}
                          onChange={(event) => updateField(record.id, field.key, event.target.value)}
                          onClick={(event) => {
                            event.currentTarget.select();
                            void copyValue(t(field.labelKey), event.currentTarget.value);
                          }}
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="copy-button"
                          title={`Copy ${t(field.labelKey)}`}
                          onClick={() => copyValue(t(field.labelKey), getDisplayField(record, field.key))}
                        >
                          <Clipboard size={15} />
                        </button>
                      </div>
                    </label>
                  ))}
                </div>

                <label className="field raw-mrz">
                  <span>{t('rawMrz')}</span>
                  <div className="input-shell textarea-shell">
                    <textarea
                      value={record.rawMrz}
                      onChange={(event) =>
                        setRecord(record.id, (current) => ({ ...current, rawMrz: event.target.value }))
                      }
                      onClick={(event) => {
                        event.currentTarget.select();
                        void copyValue(t('rawMrz'), event.currentTarget.value);
                      }}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="copy-button"
                      title={`Copy ${t('rawMrz')}`}
                      onClick={() => copyValue(t('rawMrz'), record.rawMrz)}
                    >
                      <Clipboard size={15} />
                    </button>
                  </div>
                </label>

                {record.error ? (
                  <div className="notice">
                    <AlertTriangle size={17} />
                    <span>{translateErrorMessage(record.error, t)}</span>
                  </div>
                ) : null}

                <section className={`ai-panel ${aiReview.confidence >= 85 ? 'strong' : aiReview.confidence >= 55 ? 'review' : 'manual'}`}>
                  <div className="ai-panel-header">
                    <div>
                      <h3>
                        <Sparkles size={16} />
                        {t('aiAssistant')}
                      </h3>
                      <p>{t('aiPrivate')}</p>
                    </div>
                    <strong>
                      {aiReview.confidence}%
                      <span>{t('aiConfidence')}</span>
                    </strong>
                  </div>
                  <div className="ai-meter" aria-hidden="true">
                    <span style={{ width: `${aiReview.confidence}%` }} />
                  </div>
                  <p className="ai-summary">{t(aiReview.summaryKey)}</p>

                  <div className="ai-section">
                    <div className="ai-section-header">
                      <h4>{t('aiSuggestions')}</h4>
                      <button
                        type="button"
                        className="button compact"
                        onClick={() => applyAllAiSuggestions(record, aiReview.suggestions)}
                        disabled={!aiReview.suggestions.length}
                      >
                        <Check size={15} />
                        {t('aiApplyAll')}
                      </button>
                    </div>
                    {aiReview.suggestions.length ? (
                      <div className="ai-suggestion-list">
                        {aiReview.suggestions.map((suggestion) => (
                          <div className="ai-suggestion" key={suggestion.id}>
                            <div>
                              <strong>{t(suggestion.labelKey)}</strong>
                              <span>
                                {suggestion.currentValue || '-'} {t('aiSuggestionArrow')}{' '}
                                {suggestion.suggestedValue}
                              </span>
                              <small>
                                {t(suggestion.reasonKey)} · {suggestion.confidence}%
                              </small>
                            </div>
                            <button
                              type="button"
                              className="button compact"
                              onClick={() => applyAiSuggestion(record.id, suggestion)}
                            >
                              {t('aiApply')}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ai-muted">{t('aiNoSuggestions')}</p>
                    )}
                  </div>

                  <div className="ai-section">
                    <h4>{t('aiChecks')}</h4>
                    {aiReview.issues.length ? (
                      <div className="ai-issue-list">
                        {aiReview.issues.map((issue) => (
                          <div className={`ai-issue ${issue.severity}`} key={issue.id}>
                            <span>{t(issue.messageKey)}</span>
                            {issue.detail ? <small>{issue.detail}</small> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ai-muted">{t('aiNoIssues')}</p>
                    )}
                  </div>
                </section>

                <div className="details-row">
                  <details>
                    <summary>
                      <Check size={15} />
                      {t('validationDetails')}
                    </summary>
                    <div className="detail-list">
                      {record.validationDetails.length ? (
                        record.validationDetails.map((detail, index) => (
                          <div className="detail-item" key={`${detail.label}-${index}`}>
                            <span>{detail.label}</span>
                            <strong className={detail.valid ? 'valid-text' : 'invalid-text'}>
                              {detail.valid ? t('validLabel') : detail.error || t('invalidLabel')}
                            </strong>
                          </div>
                        ))
                      ) : (
                        <p>{t('noValidation')}</p>
                      )}
                    </div>
                  </details>

                  <details>
                    <summary>
                      <Clipboard size={15} />
                      {t('ocrText')}
                    </summary>
                    <pre>{record.ocrText || t('noOcrText')}</pre>
                  </details>

                  <details>
                    <summary>
                      <Languages size={15} />
                      {t('visualText')}
                    </summary>
                    <div className="copyable-pre">
                      <pre>{record.visualOcrText || t('noVisualText')}</pre>
                      <button
                        type="button"
                        className="button compact"
                        onClick={() => copyValue(t('visualText'), record.visualOcrText)}
                        disabled={!record.visualOcrText}
                      >
                        <Clipboard size={15} />
                        {t('visualText')}
                      </button>
                    </div>
                  </details>

                  <details>
                    <summary>
                      <Search size={15} />
                      {t('extractionDetails')}
                    </summary>
                    <pre>
                      {record.extractionAttempt
                        ? `${t('extractionAttemptPrefix')}: ${record.extractionAttempt.rotation}°, ${record.extractionAttempt.crop}, ${record.extractionAttempt.variant}, score ${record.extractionAttempt.score}, candidates ${record.extractionAttempt.candidateCount}`
                        : t('noOcrText')}
                    </pre>
                  </details>
                </div>
              </div>
            </article>
            );
          })}
        </section>
      )}

      {pdfDialog ? (
        <section className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pdf-dialog-title">
          <div className="pdf-dialog">
            <div className="pdf-dialog-header">
              <div>
                <div className="eyebrow">
                  <FileText size={15} />
                  {t('pdfImport')}
                </div>
                <h2 id="pdf-dialog-title">{pdfDialog.fileName}</h2>
                <p>
                  {pdfDialog.pages.filter((page) => page.selected).length} / {pdfDialog.pages.length} {t('selectedPages')}
                </p>
              </div>
              <button className="icon-button" type="button" onClick={closePdfDialog} title={t('cancel')}>
                <X size={18} />
              </button>
            </div>

            <div className="pdf-dialog-actions">
              <button className="button compact" type="button" onClick={() => setAllPdfPages(true)}>
                <CheckCircle2 size={15} />
                {t('selectAll')}
              </button>
              <button className="button compact" type="button" onClick={() => setAllPdfPages(false)}>
                <X size={15} />
                {t('selectNone')}
              </button>
            </div>

            <div className="pdf-page-grid">
              {pdfDialog.pages.map((page) => (
                <button
                  className={`pdf-page-card ${page.selected ? 'selected' : ''}`}
                  type="button"
                  key={page.pageNumber}
                  onClick={() => togglePdfPage(page.pageNumber)}
                >
                  <span className="pdf-page-check">{page.selected ? <Check size={16} /> : null}</span>
                  <img src={page.thumbnailUrl} alt={`${pdfDialog.fileName} page ${page.pageNumber}`} />
                  <strong>
                    {t('page')} {page.pageNumber}
                  </strong>
                  <small>
                    {page.width} x {page.height}
                  </small>
                </button>
              ))}
            </div>

            {pdfDialog.error ? (
              <div className="notice">
                <AlertTriangle size={17} />
                <span>{translateErrorMessage(pdfDialog.error, t)}</span>
              </div>
            ) : null}

            <div className="pdf-dialog-footer">
              <button className="button" type="button" onClick={closePdfDialog} disabled={isImportingPdf}>
                {t('cancel')}
              </button>
              <button className="button primary" type="button" onClick={importSelectedPdfPages} disabled={isImportingPdf}>
                {isImportingPdf ? <Loader2 size={17} className="spin" /> : <Layers size={17} />}
                {isImportingPdf ? pdfImportMessage || t('rendering') : t('importSelected')}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {copiedLabel ? <div className="toast">{copiedLabel}</div> : null}
    </main>
  );
}

export default App;
