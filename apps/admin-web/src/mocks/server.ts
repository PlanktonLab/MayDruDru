/** 測試用的 MSW server（node 端）。`src/test/setup.ts` 負責啟停。 */

import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
