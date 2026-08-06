/** Convert image File (PNG/WebP/…) to JPEG for Telegram setMyProfilePhoto (static = JPG only). */
export async function fileToJpegFile(file: File, quality = 0.92): Promise<File> {
  const name = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg' || /\.jpe?g$/i.test(name)) {
    return file;
  }
  if (!mime.startsWith('image/') && !/\.(png|webp|gif|bmp)$/i.test(name)) {
    throw new Error('Нужен файл изображения (PNG или JPG)');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось обработать изображение');
    // White background — PNG transparency → JPG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Не удалось конвертировать в JPG'))),
        'image/jpeg',
        quality,
      );
    });
    const base = (file.name || 'avatar').replace(/\.[^.]+$/, '') || 'avatar';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
