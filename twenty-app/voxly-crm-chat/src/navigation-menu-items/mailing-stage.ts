import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_STAGE_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_STAGE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: MAILING_STAGE_NAV_UNIVERSAL_IDENTIFIER,
  name: 'По этапу сделки',
  icon: 'IconFilter',
  position: 3,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: MAILING_STAGE_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  folderUniversalIdentifier: MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
});
