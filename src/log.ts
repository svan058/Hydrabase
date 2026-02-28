/* eslint-disable no-console */
type Message = `[${string}] ${string}`
type Context = `- ${string}` | Record<string, unknown> | Event

export const error = (level: 'ERROR:', message: Message, context?: Context): void => context !== undefined ? console.error(level, message, context) : console.error(level, message)
export const warn = (level: 'DEVWARN:' | 'WARN:', message: Message, context?: Context): void => context !== undefined ? console.warn(level, message, context) : console.warn(level, message)
export const log = (level: 'LOG:', message: Message, context?: Context): void => context !== undefined ? console.log(level, message, context) : console.log(level, message)
