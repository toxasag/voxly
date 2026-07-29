import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  MAILING_ACCOUNTS_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_ACCOUNTS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: MAILING_ACCOUNTS_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Аккаунты',
  icon: 'IconUsers',
  position: 1,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier:
    MAILING_ACCOUNTS_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
  folderUniversalIdentifier: MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
});
