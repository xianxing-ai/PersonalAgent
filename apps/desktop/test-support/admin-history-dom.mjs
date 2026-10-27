import {authorizationDom} from './authorization-dom.mjs';

// New history navigation is mounted outside the replaceable feature body. Keep
// its real DOM descendants while each feature test retains its own observed nodes.
export function adminAuxiliaryDocument() {
  return authorizationDom().document;
}
export function recordFollowingNodes(...nodes) {
  this.followingNodes = nodes;
}
