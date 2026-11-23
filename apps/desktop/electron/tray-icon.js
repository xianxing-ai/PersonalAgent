import {Buffer} from 'node:buffer';

/** 32×32 PNG. Electron nativeImage does not reliably paint SVG data URLs on Windows. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAArUlEQVR42u2XsQ6AIAxEXU0c/Db/19nPwjCQEFPxSg8LCZd0s9yTYqnLMjWSjusMSLgZNwEpLbxue4iBPGs2zw2/Qsr9zZwCYTU3QbDMqyEk86ga85T3XBd6+3yRJK15ngftggTA2AE1gKb2KBxUBg2AJBqAtsboGaEBlEQBcC+BOwB6DjRfwRh9QCoDoxPCrfjtMrLsgOuN6DoTuE5FFPMuhtIuxvIufkymWuoGeP//kk/BcMgAAAAASUVORK5CYII=';

export function trayIconBuffer() {
  return Buffer.from(PNG_BASE64, 'base64');
}
