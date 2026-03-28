import { defineEventHandler } from 'h3'
import { buildLineupStatus } from '../lib/hdhr/lineup-status'

export default defineEventHandler(() => buildLineupStatus())
