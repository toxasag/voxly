import * as React from "react";
import { act } from "react";

// Патч совместимости React 19 и @testing-library/react.
// В React 19 react-dom/test-utils устарел. @testing-library/react при инициализации
// ищет React.act, а если не находит — берёт устаревший react-dom/test-utils.act.
// Этот файл обязан выполняться ПЕРВЫМ в setupFiles до любого импорта testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(React as unknown as { act: typeof act }).act = act;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cjsReact = require("react") as { act?: typeof act };
  if (cjsReact) cjsReact.act = act;
} catch {}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cjsDomUtils = require("react-dom/test-utils") as { act?: typeof act };
  if (cjsDomUtils) cjsDomUtils.act = act;
} catch {}
