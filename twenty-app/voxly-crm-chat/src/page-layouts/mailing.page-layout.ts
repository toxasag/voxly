import {
  definePageLayout,
  PageLayoutTabLayoutMode,
  PageLayoutType,
} from 'twenty-sdk/define';

import {
  MAILING_BOT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  MAILING_BOT_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  MAILING_BOT_PAGE_TAB_UNIVERSAL_IDENTIFIER,
  MAILING_BOT_PAGE_WIDGET_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: MAILING_BOT_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Рассылка — бот',
  type: PageLayoutType.STANDALONE_PAGE,
  tabs: [
    {
      universalIdentifier: MAILING_BOT_PAGE_TAB_UNIVERSAL_IDENTIFIER,
      title: 'Бот',
      position: 0,
      icon: 'IconRobot',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: MAILING_BOT_PAGE_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier:
              MAILING_BOT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
