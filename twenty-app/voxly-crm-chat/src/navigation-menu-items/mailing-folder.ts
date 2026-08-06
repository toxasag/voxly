import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

/**
 * Expandable «Рассылка» folder (Workflows-style). Children are PAGE_LAYOUT
 * items (in-CRM) — not external LINKs (FOLDER+https navigate bug).
 */
export default defineNavigationMenuItem({
  universalIdentifier: MAILING_FOLDER_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Рассылка',
  icon: 'IconSend',
  position: 3,
  type: NavigationMenuItemType.FOLDER,
});
