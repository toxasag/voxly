"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Home,
  Wrench,
  Wallet,
  Store,
  Handshake,
  ClipboardList,
  CircleCheckBig,
  Building2,
  Receipt,
  Loader2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { useAuth } from "@/lib/auth/use-auth";
import { isModuleInstalled } from "@/lib/context/tenant";
import {
  useGlobalSearch,
  type SearchResult,
  type SearchResultKind,
} from "@/lib/api/use-global-search";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
};

type ActionItem = {
  label: string;
  icon: LucideIcon;
  href: string;
  shortcut?: string;
};

/** Как на списках контактов и компаний — там та же величина. */
const SEARCH_DEBOUNCE_MS = 300;

const NAV_ITEMS: NavItem[] = [
  { label: "Дашборд", href: "/dashboard", icon: Home, shortcut: "G D" },
  { label: "CRM / Сделки", href: "/crm/deals", icon: Handshake, shortcut: "G C" },
  { label: "Сервисный центр", href: "/repairs", icon: Wrench, shortcut: "G R" },
  { label: "Финансы", href: "/finance", icon: Wallet, shortcut: "G F" },
  { label: "Маркетплейс", href: "/marketplace", icon: Store, shortcut: "G M" },
];

const ACTION_ITEMS: ActionItem[] = [
  { label: "Новая сделка", href: "/crm/deals?create=1", icon: Handshake, shortcut: "N D" },
  { label: "Новый наряд-заказ", href: "/repairs?create=1", icon: Wrench, shortcut: "N R" },
  { label: "Новая задача", href: "/crm/tasks?create=1", icon: ClipboardList, shortcut: "N T" },
  { label: "Новый счёт", href: "/finance?create=1", icon: Receipt, shortcut: "N I" },
];

/**
 * Порядок групп результатов.
 *
 * Сделки и контакты первыми: их ищут чаще всего, и первая строка под курсором
 * должна быть той, которую нажмут по Enter не глядя.
 */
const RESULT_GROUPS: { kind: SearchResultKind; heading: string }[] = [
  { kind: "deal", heading: "Сделки" },
  { kind: "contact", heading: "Контакты" },
  { kind: "company", heading: "Компании" },
  { kind: "task", heading: "Задачи" },
  { kind: "repair", heading: "Ремонты" },
];

/** Иконка по виду записи; компания добавилась вместе с переходом на API. */
const ENTITY_ICONS: Record<SearchResultKind, LucideIcon> = {
  deal: Handshake,
  contact: CircleCheckBig,
  company: Building2,
  task: ClipboardList,
  repair: Wrench,
};

type MenuItem = NavItem | ActionItem | SearchResult;

interface MenuSection {
  heading: string;
  items: MenuItem[];
}

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const [query, setQuery] = useState("");
  // Отдельно от `query`: запрос уходит с задержкой, а поле должно отвечать на
  // нажатие сразу.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { tenant } = useAuth();

  // Ремонты запрашиваются только при установленном модуле: иначе эндпоинт
  // отвечает 403 `MODULE_NOT_INSTALLED`, и запрос гарантированно неудачен.
  const includeRepairs = isModuleInstalled(
    tenant?.installedModules ?? [],
    "service_center",
  );

  /**
   * Задержка ввода 300 мс — как на списках контактов и компаний.
   *
   * Без неё каждое нажатие клавиши давало бы четыре запроса к API (сделки,
   * контакты, компании, ремонты), то есть «иванов» — двадцать четыре запроса.
   */
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const search = useGlobalSearch(debouncedQuery, { includeRepairs });
  const results = search.data ?? [];

  // Поиск «идёт», пока введённое не совпало с запрошенным: иначе между нажатием
  // и отправкой запроса палитра показывала бы «ничего не найдено».
  const isSearching =
    query.trim().length > 0 && (search.isFetching || query.trim() !== debouncedQuery);

  const sections: MenuSection[] = [
    ...(query.trim() === ""
      ? [
          {
            heading: "Навигация",
            items: NAV_ITEMS,
          },
          {
            heading: "Быстрые действия",
            items: ACTION_ITEMS,
          },
        ]
      : []),
    // Результаты разбиты по видам записей, а не свалены в один список: до
    // четырёх источников по пять записей — двадцать строк, в которых сделка и
    // ремонт неразличимы без заголовка.
    ...RESULT_GROUPS.flatMap((group) => {
      const items = results.filter((item) => item.kind === group.kind);
      return items.length > 0 ? [{ heading: group.heading, items }] : [];
    }),
  ];

  const flatItems = sections.flatMap((s) => s.items);

  /**
   * Палитра — такой же оверлей, как модальные окна.
   *
   * Найдено при проверке мобильного бара: палитра открывалась, а прокрутка фона
   * оставалась и бар не прятался — она была единственным оверлеем портала, не
   * попавшим в общий стек. Escape тоже обрабатывался отдельно и закрывал бы
   * заодно карточку под палитрой.
   */
  const closePalette = useCallback(() => onOpenChange(false), [onOpenChange]);

  useOverlay(open, { onEscape: closePalette });

  // Открытие остаётся здесь: ⌘K и ⌘N работают, когда палитра закрыта, то есть
  // вне стека оверлеев. Escape ушёл в `useOverlay` — им распоряжается стек.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isCmdN = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n";

      if (isCmdK) {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (isCmdN) {
        e.preventDefault();
        router.push("/crm/deals?create=1");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange, router]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
    }
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (item: NavItem | ActionItem | SearchResult) => {
      onOpenChange(false);
      setQuery("");
      // Адрес приходит в самом результате и ведёт на запись, а не на список
      // раздела: прежде `ENTITY_HREF` содержал `/crm/deals` без идентификатора, и
      // найденная сделка открывала воронку целиком.
      router.push(item.href);
    },
    [onOpenChange, router],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }
    if (e.key === "Enter" && flatItems[selectedIndex]) {
      e.preventDefault();
      handleSelect(flatItems[selectedIndex]);
    }
  };

  if (!open) return null;

  let globalIndex = 0;

  // На мобильном палитра занимает весь экран: `pt-[15vh]` вместе с `max-h-[50vh]`
  // у списка оставляли результаты под экранной клавиатурой — она занимает около 40%
  // высоты, отступ сверху ещё 15%, и на список приходилась узкая полоса. С `md:`
  // отступ возвращается: на десктопе палитра посередине экрана выглядит привычнее.
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center md:pt-[15vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      {/*
        На телефоне палитра — отдельный экран, поэтому ни скруглений, ни рамки по
        краям: они выглядели бы как незакрытое окно. `flex h-full flex-col` нужен,
        чтобы список занял всю оставшуюся высоту между полем и подвалом.
      */}
      <div className="relative flex h-full w-full flex-col bg-slate-900 shadow-2xl md:h-auto md:max-w-xl md:rounded-xl md:border md:border-slate-700">
        <div className="flex items-center gap-3 border-b border-slate-800 px-4">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск... сделки, контакты, ремонты или команда"
            className="h-12 w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
          />
          {/* Физической клавиатуры на телефоне нет: подсказка занимала бы место
              в тесной строке поиска без пользы. */}
          <kbd className="hidden shrink-0 rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-500 md:inline">
            ESC
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 md:max-h-[50vh] md:flex-none">
          {sections.map((section) => (
            <div key={section.heading} className="mb-2">
              <p className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                {section.heading}
              </p>
              {section.items.map((item) => {
                const Icon = "icon" in item ? item.icon : ENTITY_ICONS[item.kind] ?? Search;
                const currentGlobalIndex = globalIndex++;
                const isSelected = currentGlobalIndex === selectedIndex;

                return (
                  <button
                    key={"id" in item ? item.id : item.href}
                    type="button"
                    onClick={() => handleSelect(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      isSelected
                        ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md border",
                        isSelected
                          ? "border-[#4a38f5]/30 bg-[#4a38f5]/10"
                          : "border-slate-700 bg-slate-950",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">
                        {"label" in item ? item.label : item.title}
                      </p>
                      {"subtitle" in item && (
                        <p className="truncate text-xs text-slate-500">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                    {"shortcut" in item && (
                      <kbd className="rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-500">
                        {item.shortcut}
                      </kbd>
                    )}
                    {"kind" in item && (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-600" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/*
            Три состояния вместо одного. Прежде поиск шёл по массивам в памяти и
            был мгновенным, поэтому существовало только «ничего не найдено»; с
            запросом к API нужны ещё «идёт поиск» и «запрос не удался» — иначе при
            медленной сети палитра утверждает, что записи нет, пока ответ в пути.
          */}
          {isSearching && (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Поиск...
            </div>
          )}

          {!isSearching && search.isError && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-rose-400">Не удалось выполнить поиск</p>
              <p className="mt-1 text-xs text-slate-500">{search.error.message}</p>
            </div>
          )}

          {!isSearching && !search.isError && query.trim() !== "" && results.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-500">Ничего не найдено по запросу &quot;{query}&quot;</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2">
          {/* Те же соображения: стрелки и Enter относятся к физической клавиатуре. */}
          <div className="hidden items-center gap-3 text-xs text-slate-500 md:flex">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-slate-800 px-1 py-0.5">↑</kbd>
              <kbd className="rounded bg-slate-800 px-1 py-0.5">↓</kbd>
              Навигация
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-slate-800 px-1 py-0.5">↵</kbd>
              Выбрать
            </span>
          </div>
          <span className="text-xs text-slate-600">
            {flatItems.length} элементов
          </span>
        </div>
      </div>
    </div>
  );
}
