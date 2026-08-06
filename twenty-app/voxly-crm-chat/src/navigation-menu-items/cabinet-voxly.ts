import {
  defineNavigationMenuItem,
  NavigationMenuItemType,
} from 'twenty-sdk/define';

import { CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { voxlyCabinetUrl } from 'src/lib/portal-base-url';

export default defineNavigationMenuItem({
  universalIdentifier: CABINET_VOXLY_NAV_UNIVERSAL_IDENTIFIER,
  name: 'Кабинет Voxly',
  icon: 'IconHome',
  position: 6,
  type: NavigationMenuItemType.LINK,
  link: voxlyCabinetUrl(),
});

