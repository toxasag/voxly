import {
  definePageLayout,
  PageLayoutTabLayoutMode,
  PageLayoutType,
} from 'twenty-sdk/define';

import {
  MAILING_ACCOUNTS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  MAILING_ACCOUNTS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  MAILING_ACCOUNTS_PAGE_TAB_UNIVERSAL_IDENTIFIER,
  MAILING_ACCOUNTS_PAGE_WIDGET_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: MAILING_ACCOUNTS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Рассылка — аккаунты',
  type: PageLayoutType.STANDALONE_PAGE,
  tabs: [
    {
      universalIdentifier: MAILING_ACCOUNTS_PAGE_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Аккаунты',
      position: 0,
      icon: 'IconUsers',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: MAILING_ACCOUNTS_PAGE_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier:
              MAILING_ACCOUNTS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
