import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_STORIES_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_STORIES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: MAILING_STORIES_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Сторис',
  icon: 'IconPhoto',
  position: 2,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier:
    MAILING_STORIES_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  folderUniversalIdentifier: MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
});
