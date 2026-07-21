import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

/** Portal dashboard URL (browser-reachable). Override via re-apply if env differs. */
const VOXLY_CABINET_URL = 'http://localhost:3001/dashboard';

export default defineNavigationMenuItem({
  universalIdentifier: CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Кабинет Voxly',
  icon: 'IconHome',
  position: 0,
  type: NavigationMenuItemType.LINK,
  link: VOXLY_CABINET_URL,
});
