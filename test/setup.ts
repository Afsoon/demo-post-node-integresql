import { afterAll, aroundEach, beforeAll } from 'vitest'
import { polarServer } from './support/polar-mock.ts'
import { releaseGlobalTestDatabase } from './support/database.ts'

beforeAll(() => polarServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => polarServer.close())
afterAll(() => releaseGlobalTestDatabase())

aroundEach((runTest) => polarServer.boundary(runTest)())
