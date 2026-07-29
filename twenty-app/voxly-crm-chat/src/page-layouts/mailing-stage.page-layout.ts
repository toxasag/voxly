import {
  definePageLayout,
  PageLayoutTabLayoutMode,
  PageLayoutType,
} from 'twenty-sdk/define';

import {
  MAILING_STAGE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  MAILING_STAGE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  MAILING_STAGE_PAGE_TAB_UNIVERSAL_IDENTIFIER,
  MAILING_STAGE_PAGE_WIDGET_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayout({
  universalIdentifier: MAILING_STAGE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  name: 'Рассылка — по этапу сделки',
  type: PageLayoutType.STANDALONE_PAGE,
  tabs: [
    {
      universalIdentifier: MAILING_STAGE_PAGE_TAB_UNIVERSAL_IDENTIFIER,
      title: 'По этапу',
      position: 0,
      icon: 'IconFilter',
      layoutMode: PageLayoutTabLayoutMode.CANVAS,
      widgets: [
        {
          universalIdentifier: MAILING_STAGE_PAGE_WIDGET_UNIVERSAL_IDENTIFIER,
          title: ' ',
          type: 'FRONT_COMPONENT',
          gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
          configuration: {
            configurationType: 'FRONT_COMPONENT',
            frontComponentUniversalIdentifier:
              MAILING_STAGE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
          },
        },
      ],
    },
  ],
});
