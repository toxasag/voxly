import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import {
  MAILING_NAV_UNIVERSAL_IDENTIFIER,
  MAILING_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

/**
 * In-CRM «Рассылка» (ADR-018 amended): opens STANDALONE_PAGE with front-component,
 * same pattern as chat tabs — not an external portal LINK.
 */
export default defineNavigationMenuItem({
  universalIdentifier: MAILING_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Рассылка',
  icon: 'IconSend',
  position: 1,
  type: NavigationMenuItemType.PAGE_LAYOUT,
  pageLayoutUniversalIdentifier: MAILING_PAGE_LAYOUT_UNIVERSAL_IDENTIFIER,
});
