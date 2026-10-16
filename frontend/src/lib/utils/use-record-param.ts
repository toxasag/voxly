"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Открытая карточка записи в адресе страницы.
//
// Зачем понадобилось: поиск в палитре (⌘K) обязан открывать саму запись, а не
// список раздела. У карточек контакта и компании своего маршрута нет — они
// открываются панелью поверх списка, — поэтому ссылка выражается параметром
// `?record=<id>`.
//
// Побочные следствия, из-за которых это правильнее локального `useState`:
//  - на телефоне системная кнопка «назад» закрывает карточку, а не уводит со
//    страницы списка;
//  - карточку можно отправить коллеге ссылкой;
//  - обновление страницы с открытой карточкой возвращает её же.
//
// `replace`, а не `push`, при закрытии: иначе каждое открытие и закрытие копило бы
// записи в истории, и «назад» пришлось бы нажимать столько раз, сколько карточек
// пользователь посмотрел.
// ---------------------------------------------------------------------------

interface RecordParamResult {
  /** Идентификатор открытой записи или `null`. */
  recordId: string | null;
  openRecord: (id: string) => void;
  closeRecord: () => void;
}

export function useRecordParam(param = "record"): RecordParamResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fromUrl = searchParams.get(param);

  // Локальная копия нужна для мгновенного отклика: навигация Next.js
  // асинхронна, и без копии карточка появлялась бы с задержкой в кадр-два после
  // нажатия — на списке это читается как «клик не сработал».
  const [recordId, setRecordId] = useState<string | null>(fromUrl);

  // Синхронизация в обратную сторону: переход «назад», внешняя ссылка и
  // обновление страницы меняют адрес, а не состояние.
  useEffect(() => {
    setRecordId(fromUrl);
  }, [fromUrl]);

  const openRecord = useCallback(
    (id: string) => {
      setRecordId(id);

      const next = new URLSearchParams(searchParams.toString());
      next.set(param, id);
      // `push`: открытие карточки — шаг вперёд, «назад» должен её закрывать.
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [param, pathname, router, searchParams],
  );

  const closeRecord = useCallback(() => {
    setRecordId(null);

    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const query = next.toString();

    // `replace`: закрытие не добавляет запись в историю, иначе «назад» снова
    // открывало бы только что закрытую карточку.
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [param, pathname, router, searchParams]);

  return { recordId, openRecord, closeRecord };
}
