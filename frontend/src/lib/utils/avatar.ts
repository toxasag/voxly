// ---------------------------------------------------------------------------
// Подготовка аватара на клиенте.
//
// Сжатие выполняется в браузере, а не на сервере, потому что загрузки файлов в
// проекте нет ни в каком виде: ни multipart-плагина, ни объектного хранилища, ни
// раздачи статики. Изображение приводится к квадрату 256×256 и отправляется
// Base64 data-URI в TEXT-колонке — это осознанный компромисс, который закрывает
// сценарий «выбрать файл с диска» без новой инфраструктуры и переносится на S3
// заменой одного поля.
//
// Отправлять исходный файл нельзя: снимок с телефона — это 3–8 МБ, он не прошёл
// бы серверную проверку размера и раздул бы каждый ответ профиля.
//
// Область обрезки задаёт пользователь (см. AvatarCropModal): автоматическая
// обрезка по центру срезала лицо на портретных снимках, где оно смещено вверх.
// ---------------------------------------------------------------------------

/** Сторона итогового квадрата. Совпадает с решением по аватарам. */
export const TARGET_SIZE = 256;

/** Предел исходного файла: проверяется до чтения, чтобы не занимать память зря. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** Совпадает с MAX_AVATAR_BYTES на сервере. */
const MAX_RESULT_BYTES = 512 * 1024;

/** Пределы масштаба в окне обрезки. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export class AvatarError extends Error {}

/** Выбранная пользователем область исходного изображения, в его пикселях. */
export interface CropArea {
  x: number;
  y: number;
  size: number;
}

/** Приблизительный размер data-URI в байтах. */
function dataUriBytes(dataUri: string): number {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Загружает файл в `HTMLImageElement`.
 *
 * Возвращает и сам объект URL: окно обрезки показывает изображение до
 * применения, поэтому освобождать ссылку сразу нельзя — это делает вызывающий
 * через `releaseImage`.
 */
export function loadImageFile(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new AvatarError("Выберите файл изображения"));
      return;
    }

    if (file.size > MAX_SOURCE_BYTES) {
      reject(
        new AvatarError(
          `Файл больше ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} МБ. Выберите изображение меньше.`,
        ),
      );
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        URL.revokeObjectURL(url);
        reject(new AvatarError("Изображение повреждено"));
        return;
      }
      resolve({ image, url });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarError("Не удалось прочитать изображение"));
    };

    image.src = url;
  });
}

/** Освобождает objectURL: без этого каждый выбор файла держит объект в памяти. */
export function releaseImage(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * Кодирует выбранную область в data-URI 256×256.
 *
 * WebP с откатом на JPEG: Safari до 14 не кодирует WebP, и `toDataURL` молча
 * вернул бы PNG — он в 3–5 раз тяжелее и мог бы не пройти серверный лимит.
 */
export function encodeAvatar(image: HTMLImageElement, crop: CropArea): string {
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;

  const context = canvas.getContext("2d");
  if (context === null) throw new AvatarError("Браузер не поддерживает обработку изображений");

  // Сглаживание при уменьшении: без него итог выглядит зернистым, потому что
  // 256×256 из снимка 4000px — это уменьшение более чем в 15 раз.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  // Область ограничивается границами изображения: перетаскивание в окне может
  // вывести рамку за край, и тогда drawImage вернул бы прозрачные полосы.
  //
  // Сторона не превышает короткую сторону изображения — это и есть предел
  // «cover» для квадратной рамки. Смещение приводится к диапазону по каждой оси
  // отдельно, потому что по длинной оси запас есть, а по короткой его нет.
  const size = Math.max(1, Math.min(crop.size, image.naturalWidth, image.naturalHeight));
  const x = Math.max(0, Math.min(crop.x, image.naturalWidth - size));
  const y = Math.max(0, Math.min(crop.y, image.naturalHeight - size));

  context.drawImage(image, x, y, size, size, 0, 0, TARGET_SIZE, TARGET_SIZE);

  // Качество снижается ступенями, пока результат не уложится в лимит: у
  // фотографий с шумом WebP на 0.8 иногда даёт больше ожидаемого.
  for (const quality of [0.8, 0.6, 0.45]) {
    for (const mime of ["image/webp", "image/jpeg"]) {
      const dataUri = canvas.toDataURL(mime, quality);

      // Браузер без поддержки формата возвращает PNG — такой результат
      // пропускаем и пробуем следующий тип.
      if (!dataUri.startsWith(`data:${mime}`)) continue;
      if (dataUriBytes(dataUri) <= MAX_RESULT_BYTES) return dataUri;
    }
  }

  // Ни один вариант не уложился: 256×256 при q=0.45 весит десятки килобайт,
  // поэтому это означает неожиданное поведение кодировщика, а не большое фото.
  throw new AvatarError("Не удалось сжать изображение. Попробуйте другой файл.");
}

/**
 * Область по центру — начальное положение рамки при открытии окна.
 *
 * Служит и запасным путём: если окно обрезки почему-то не смогло определить
 * область, изображение всё равно будет обрезано осмысленно.
 */
export function centeredCrop(image: HTMLImageElement): CropArea {
  const size = Math.min(image.naturalWidth, image.naturalHeight);

  return {
    x: (image.naturalWidth - size) / 2,
    y: (image.naturalHeight - size) / 2,
    size,
  };
}
