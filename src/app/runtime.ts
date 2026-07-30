import { db } from '../db'
import { createMouseKeeperService } from '../services'

export const appDatabase = db
export const appService = createMouseKeeperService(appDatabase)
