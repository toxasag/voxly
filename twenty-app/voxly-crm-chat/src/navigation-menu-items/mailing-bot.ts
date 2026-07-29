import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  MAILING_BOT_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_BOT_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: MAILING_BOT_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Бот',
  icon: 'IconRobot',
  position: 0,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: MAILING_BOT_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  folderUniversalIdentifier: MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
});
