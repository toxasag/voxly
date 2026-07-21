import {
  definePageLayoutTab,
  PageLayoutTabLayoutMode,
  STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  CHAT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  PERSON_CHAT_TAB_UNIVERSAL_IDENTIFIER,
  PERSON_CHAT_WIDGET_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default definePageLayoutTab({
  universalIdentifier: PERSON_CHAT_TAB_UNIVERSAL_IDENTIFIER,
  pageLayoutUniversalIdentifier:
    STANDARD_PAGE_LAYOUT_UNIVERSAL_IDENTIFIERS.personRecordPage.universalIdentifier,
  title: 'Чат',
  position: 15,
  icon: 'IconMessage',
  layoutMode: PageLayoutTabLayoutMode.CANVAS,
  widgets: [
    {
      universalIdentifier: PERSON_CHAT_WIDGET_UNIVERSAL_IDENTIFIER,
      title: ' ',
      type: 'FRONT_COMPONENT',
      gridPosition: { row: 0, column: 0, rowSpan: 12, columnSpan: 12 },
      configuration: {
        configurationType: 'FRONT_COMPONENT',
        frontComponentUniversalIdentifier: CHAT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
      },
    },
  ],
});
